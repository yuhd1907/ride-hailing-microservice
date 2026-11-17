'use strict';
// Lớp duy nhất chạm vào Docker Compose, RabbitMQ và PostgreSQL của thí nghiệm hiệu năng.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { QUEUES, REQUIRED_CONTAINERS, preflightProblems, runProblems, waitFor } = require('./checks');
const { pickClockOffset, summarizeRun } = require('./stats');

const root = path.join(__dirname, '..', '..');
const EXCHANGE = 'rideflow.events';
const HEALTHY_TIMEOUT_MS = 180000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Cùng một nguồn đồng hồ cho mốc gửi và mẫu đồng hồ, độ phân giải dưới mili giây.
const hostNow = () => performance.timeOrigin + performance.now();

function loadConfig() {
  require('../../trip-service/node_modules/dotenv').config({ path: path.join(root, '.env'), quiet: true });
  const env = process.env;
  const db = (prefix, port, database) => ({
    host: '127.0.0.1',
    port: Number(env[`${prefix}_DB_PORT`] || port),
    user: env[`${prefix}_DB_USER`] || 'postgres',
    password: env[`${prefix}_DB_PASSWORD`] || 'postgres_password',
    database: env[`${prefix}_DB_NAME`] || database,
    max: 4,
  });
  const user = encodeURIComponent(env.RABBITMQ_DEFAULT_USER || 'guest');
  const pass = encodeURIComponent(env.RABBITMQ_DEFAULT_PASS || 'guest');
  return {
    root,
    paymentDb: db('PAYMENT', 5437, 'payment_db'),
    notificationDb: db('NOTIFICATION', 5438, 'notification_db'),
    amqpUrl: `amqp://${user}:${pass}@127.0.0.1:${env.RABBITMQ_PORT || 5672}`,
  };
}

async function connect(config) {
  const { Pool } = require('../../trip-service/node_modules/pg');
  const amqp = require('../../trip-service/node_modules/amqplib');
  const payment = new Pool(config.paymentDb);
  const notification = new Pool(config.notificationDb);
  const connection = await amqp.connect(config.amqpUrl);
  connection.on('error', () => {});
  return {
    config, payment, notification, amqp: connection,
    async close() {
      await Promise.allSettled([payment.end(), notification.end(), connection.close()]);
    },
  };
}

function compose(config, args, env = {}) {
  const files = ['-f', 'deploy/docker-compose.yml'];
  if (env.PAYMENT_LISTENER_CONCURRENCY) files.push('-f', 'deploy/docker-compose.perf.yml');
  if (fs.existsSync(path.join(config.root, '.env'))) files.push('--env-file', '.env');
  return execFileSync('docker', ['compose', ...files, ...args], {
    cwd: config.root, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function containerHealth(config, service) {
  const id = compose(config, ['ps', '-q', service]).trim();
  if (!id) return 'missing';
  return execFileSync('docker', ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', id], { encoding: 'utf8' }).trim();
}

function waitHealthy(config, service) {
  return waitFor(async () => containerHealth(config, service) === 'healthy',
    { label: `${service} healthy`, timeoutMs: HEALTHY_TIMEOUT_MS, intervalMs: 2000 });
}

async function withChannel(infra, work) {
  const channel = await infra.amqp.createChannel();
  let closed = false;
  channel.on('error', () => {});
  channel.on('close', () => { closed = true; });
  try {
    return await work(channel);
  } finally {
    if (!closed) await channel.close().catch(() => {});
  }
}

async function queueState(infra, name) {
  try {
    return await withChannel(infra, async channel => {
      const q = await channel.checkQueue(name);
      return { name, exists: true, messages: q.messageCount, consumers: q.consumerCount };
    });
  } catch (error) {
    if (error.code === 404 || /404|NOT_FOUND/.test(error.message)) return { name, exists: false, messages: 0, consumers: 0 };
    throw error;
  }
}

async function pendingOutbox(infra) {
  const { rows } = await infra.payment.query('SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL');
  return rows[0].n;
}

async function preflight(infra) {
  const containers = REQUIRED_CONTAINERS.map(name => ({ name, health: containerHealth(infra.config, name) }));
  const queues = [];
  for (const name of [QUEUES.payment, QUEUES.notification, ...QUEUES.trip]) queues.push(await queueState(infra, name));
  return preflightProblems({ containers, queues, pendingOutbox: await pendingOutbox(infra) });
}

function stopTrip(config) {
  compose(config, ['stop', 'trip_service']);
}

async function restore(infra) {
  const { config } = infra;
  compose(config, ['up', '-d', '--no-deps', '--no-build', 'payment_service']);
  await waitHealthy(config, 'payment_service');
  // Cố gắng xử lý hết message còn lại của lượt bị dừng trước khi dọn queue của Trip.
  await waitFor(async () => (await queueState(infra, QUEUES.payment)).messages === 0 && (await pendingOutbox(infra)) === 0,
    { label: 'Payment xử lý hết message còn lại', timeoutMs: 60000, intervalMs: 1000 }).catch(() => {});
  await sleep(2000);
  await withChannel(infra, async channel => {
    for (const name of QUEUES.trip) {
      if ((await queueState(infra, name)).exists) await channel.purgeQueue(name);
    }
  });
  compose(config, ['start', 'trip_service']);
}

async function setConsumers(infra, consumers) {
  compose(infra.config, ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'payment_service'],
    { PAYMENT_LISTENER_CONCURRENCY: String(consumers) });
  await waitHealthy(infra.config, 'payment_service');
  await waitFor(async () => (await queueState(infra, QUEUES.payment)).consumers === consumers,
    { label: `${consumers} consumer trên ${QUEUES.payment}`, timeoutMs: 30000, intervalMs: 500 }).catch(() => {});
  return (await queueState(infra, QUEUES.payment)).consumers;
}

async function measureClock(infra) {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const hostBefore = hostNow();
    const { rows } = await infra.payment.query('SELECT (extract(epoch from clock_timestamp()) * 1000)::float8 AS t');
    samples.push({ hostBefore, hostAfter: hostNow(), dbTime: rows[0].t });
  }
  return pickClockOffset(samples);
}

async function dlqCounts(infra) {
  const counts = {};
  for (const name of QUEUES.dlq) counts[name] = (await queueState(infra, name)).messages;
  return counts;
}

function tripCompletedEvent() {
  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    eventId, eventType: 'trip.completed', correlationId: crypto.randomUUID(), occurredAt: now,
    payload: { tripId: crypto.randomUUID(), riderId: crypto.randomUUID(), driverId: crypto.randomUUID(), fareAmount: 125000, completedAt: now },
  };
}

async function publishBatch(infra, events) {
  const channel = await infra.amqp.createConfirmChannel();
  channel.on('error', () => {});
  const sentAt = [];
  try {
    for (const event of events) {
      sentAt.push(hostNow());
      const ok = channel.publish(EXCHANGE, event.eventType, Buffer.from(JSON.stringify(event)), {
        persistent: true, contentType: 'application/json', messageId: event.eventId, type: event.eventType,
        correlationId: event.correlationId, headers: { 'x-correlation-id': event.correlationId },
      });
      if (!ok) await new Promise(resolve => channel.once('drain', resolve));
    }
    await channel.waitForConfirms();
  } finally {
    await channel.close().catch(() => {});
  }
  return sentAt;
}

async function measureRun(infra, { consumers, events, run, timeoutMs }) {
  const clock = await measureClock(infra);
  const dlqBefore = await dlqCounts(infra);
  const batch = Array.from({ length: events }, tripCompletedEvent);
  const tripIds = batch.map(e => e.payload.tripId);
  const startedAt = new Date().toISOString();
  const sentAt = await publishBatch(infra, batch);
  await waitFor(async () => {
    const { rows } = await infra.notification.query('SELECT count(DISTINCT trip_id)::int AS n FROM notifications WHERE trip_id = ANY($1::uuid[])', [tripIds]);
    return rows[0].n === events;
  }, { label: `thông báo của ${events} event`, timeoutMs });
  // OutboxRelay chỉ commit published_at sau cả lô 50 event.
  await waitFor(async () => {
    const { rows } = await infra.payment.query('SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ANY($1::uuid[]) AND published_at IS NULL', [tripIds]);
    return rows[0].n === 0;
  }, { label: 'outbox ghi xong published_at', timeoutMs: 10000 });
  const { rows: payments } = await infra.payment.query(
    `SELECT p.trip_id::text AS trip_id, p.status,
            (extract(epoch from p.created_at) * 1000)::float8 AS payment_at,
            (extract(epoch from o.published_at) * 1000)::float8 AS published_at
       FROM payments p LEFT JOIN outbox_events o ON o.aggregate_id = p.trip_id
      WHERE p.trip_id = ANY($1::uuid[])`, [tripIds]);
  const { rows: notifications } = await infra.notification.query(
    `SELECT trip_id::text AS trip_id, (extract(epoch from min(created_at)) * 1000)::float8 AS notified_at
       FROM notifications WHERE trip_id = ANY($1::uuid[]) GROUP BY trip_id`, [tripIds]);
  const paymentByTrip = new Map(payments.map(r => [r.trip_id, r]));
  const notifiedByTrip = new Map(notifications.map(r => [r.trip_id, r.notified_at]));
  const problems = runProblems({
    expected: events,
    successCount: payments.filter(r => r.status === 'SUCCESS').length,
    notifiedCount: notifications.length,
    dlqBefore,
    dlqAfter: await dlqCounts(infra),
  });
  if (problems.length) throw new Error(`Lượt ${run} (${consumers} consumer, ${events} event) không hợp lệ:\n- ${problems.join('\n- ')}`);
  const samples = tripIds.map((tripId, i) => ({
    sentAt: sentAt[i],
    paymentAt: paymentByTrip.get(tripId)?.payment_at,
    publishedAt: paymentByTrip.get(tripId)?.published_at,
    notifiedAt: notifiedByTrip.get(tripId),
  }));
  const summary = summarizeRun({ consumers, events, run, startedAt, clockOffsetMs: clock.offsetMs, clockRttMs: clock.rttMs, samples });
  await sleep(2000);
  return summary;
}

function gitCommit(config) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: config.root, encoding: 'utf8' }).trim();
  } catch {
    return 'không rõ';
  }
}

function environmentInfo(config, options) {
  let docker = 'không rõ';
  try {
    docker = execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).trim();
  } catch { /* để nguyên "không rõ" */ }
  const cpus = os.cpus();
  return [
    `Thời điểm: ${new Date().toISOString()}`,
    `Commit: ${gitCommit(config)}`,
    `CPU: ${cpus[0]?.model ?? 'không rõ'} x ${cpus.length}`,
    `RAM: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`,
    `Hệ điều hành: ${os.type()} ${os.release()} (${os.arch()})`,
    `Node: ${process.version}`,
    `Docker: ${docker}`,
    `Tham số: ${JSON.stringify(options)}`,
    '',
  ].join('\n');
}

module.exports = {
  loadConfig, connect, compose, containerHealth, queueState, preflight, stopTrip, restore,
  setConsumers, measureRun, gitCommit, environmentInfo,
};
