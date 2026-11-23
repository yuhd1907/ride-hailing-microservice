'use strict';
// Disk-constrained verification: cached infrastructure images + tmpfs databases;
// real application JARs/Node services run on the host. No fake service responses.
// Requires a successful ./gradlew build and npm ci in trip-service/matching-service.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require('../trip-service/node_modules/dotenv').config({ path: path.join(root, '.env') });
const directory = path.join(root, '.verification/phase3-local');
fs.mkdirSync(directory, { recursive: true });
const processes = [];
const composeFile = path.join(directory, 'compose.json');
const composeArgs = ['compose', '-p', 'ride-phase3-local', '-f', composeFile];
const env = process.env;
const services = {};
for (const prefix of ['USER', 'DRIVER', 'TRIP', 'MATCHING', 'PAYMENT', 'NOTIFICATION']) {
  const key = prefix.toLowerCase();
  const schema = ['TRIP', 'MATCHING'].includes(prefix) ? [{ type: 'bind', source: path.join(root, `${key}-service/${key}_db.sql`), target: '/docker-entrypoint-initdb.d/01-schema.sql', read_only: true }] : [];
  services[`${key}_postgres`] = {
    image: 'postgres:16-alpine', ports: [`127.0.0.1:${env[`${prefix}_DB_PORT`]}:5432`],
    environment: { POSTGRES_USER: env[`${prefix}_DB_USER`], POSTGRES_PASSWORD: env[`${prefix}_DB_PASSWORD`], POSTGRES_DB: env[`${prefix}_DB_NAME`] },
    tmpfs: ['/var/lib/postgresql/data'], volumes: schema,
    healthcheck: { test: ['CMD-SHELL', `pg_isready -U ${env[`${prefix}_DB_USER`]} -d ${env[`${prefix}_DB_NAME`]}`], interval: '2s', timeout: '3s', retries: 30 },
    logging: { driver: 'json-file', options: { 'max-size': '1m', 'max-file': '1' } },
  };
}
services.redis = { image: 'redis:7-alpine', ports: [`127.0.0.1:${env.REDIS_PORT || 6379}:6379`], command: ['redis-server', '--save', '', '--appendonly', 'no'], healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '2s', timeout: '3s', retries: 20 } };
services.rabbitmq = { image: 'rabbitmq:3-management-alpine', ports: [`127.0.0.1:${env.RABBITMQ_PORT || 5672}:5672`], environment: { RABBITMQ_DEFAULT_USER: env.RABBITMQ_DEFAULT_USER, RABBITMQ_DEFAULT_PASS: env.RABBITMQ_DEFAULT_PASS }, tmpfs: ['/var/lib/rabbitmq'], healthcheck: { test: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping'], interval: '3s', timeout: '5s', retries: 30 } };
for (const service of Object.values(services)) service.logging ||= { driver: 'json-file', options: { 'max-size': '1m', 'max-file': '1' } };
fs.writeFileSync(composeFile, JSON.stringify({ services }, null, 2));

function start(name, executable, args, childEnv = {}) {
  const stdout = fs.openSync(path.join(directory, `${name}.stdout.log`), 'w');
  const stderr = fs.openSync(path.join(directory, `${name}.stderr.log`), 'w');
  const child = spawn(executable, args, { cwd: root, env: { ...env, ...childEnv }, windowsHide: true, stdio: ['ignore', stdout, stderr] });
  fs.closeSync(stdout); fs.closeSync(stderr);
  child.on('error', error => console.error(`${name}: ${error.message}`));
  processes.push({ name, child });
  console.log(`Started ${name}, pid=${child.pid}`);
  return child;
}
function java(service, port, prefix, suffix = '') {
  const libs = path.join(root, service, 'build/libs');
  const jar = fs.readdirSync(libs).find(name => name.endsWith('.jar') && !name.endsWith('-plain.jar'));
  if (!jar) throw new Error(`Build ${service} first`);
  const args = ['-Xmx160m', `-Djava.io.tmpdir=${directory}`, '-jar', path.join(libs, jar), `--server.port=${port}`, '--eureka.client.service-url.defaultZone=http://127.0.0.1:8761/eureka/', '--eureka.instance.ip-address=127.0.0.1', '--eureka.instance.prefer-ip-address=true', `--eureka.instance.instance-id=${service}-phase3${suffix}`, '--spring.data.redis.host=127.0.0.1', `--spring.data.redis.port=${env.REDIS_PORT || 6379}`, '--spring.rabbitmq.host=127.0.0.1', `--spring.rabbitmq.port=${env.RABBITMQ_PORT || 5672}`, `--spring.rabbitmq.username=${env.RABBITMQ_DEFAULT_USER}`, `--spring.rabbitmq.password=${env.RABBITMQ_DEFAULT_PASS}`];
  if (prefix) args.push(`--spring.datasource.url=jdbc:postgresql://127.0.0.1:${env[`${prefix}_DB_PORT`]}/${env[`${prefix}_DB_NAME`]}`, `--spring.datasource.username=${env[`${prefix}_DB_USER`]}`, `--spring.datasource.password=${env[`${prefix}_DB_PASSWORD`]}`);
  return start(service + suffix, 'java', args);
}
async function wait(label, url, timeout = 120000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const dead = processes.find(({ child }) => child.exitCode !== null);
    if (dead) throw new Error(`${dead.name} exited (${dead.child.exitCode}); inspect .verification/phase3-local logs`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timeout: ${label}`);
}
async function run() {
  console.log('Starting isolated infrastructure with tmpfs databases (data removed at the end).');
  execFileSync('docker', [...composeArgs, 'up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '100'], { cwd: root, stdio: 'inherit', timeout: 130000, windowsHide: true });
  java('eureka-server', 8761);
  await wait('Eureka', 'http://127.0.0.1:8761/actuator/health');
  java('api-gateway', env.GATEWAY_PORT || 8080);
  java('user-service', env.USER_SERVICE_PORT || 8081, 'USER');
  java('driver-service', env.DRIVER_SERVICE_PORT_1 || 8082, 'DRIVER', '-1');
  java('driver-service', env.DRIVER_SERVICE_PORT_2 || 18082, 'DRIVER', '-2');
  java('payment-service', env.PAYMENT_SERVICE_PORT || 8085, 'PAYMENT');
  java('notification-service', env.NOTIFICATION_SERVICE_PORT || 8086, 'NOTIFICATION');
  for (const prefix of ['TRIP', 'MATCHING']) {
    const service = prefix.toLowerCase() + '-service';
    start(service, process.execPath, [path.join(root, service, 'src/server.js')], {
      DATABASE_URL: `postgresql://${encodeURIComponent(env[`${prefix}_DB_USER`])}:${encodeURIComponent(env[`${prefix}_DB_PASSWORD`])}@127.0.0.1:${env[`${prefix}_DB_PORT`]}/${env[`${prefix}_DB_NAME`]}`,
      RABBITMQ_URL: `amqp://${encodeURIComponent(env.RABBITMQ_DEFAULT_USER)}:${encodeURIComponent(env.RABBITMQ_DEFAULT_PASS)}@127.0.0.1:${env.RABBITMQ_PORT || 5672}`,
      EUREKA_HOST: '127.0.0.1', EUREKA_INSTANCE_IP: '127.0.0.1', HOSTNAME: 'localhost',
    });
  }
  for (const port of [8081, 8082, 18082, 8083, 8084, 8085, 8086]) await wait(`service ${port}`, `http://127.0.0.1:${port}/ping`);
  await wait('Gateway', `http://127.0.0.1:${env.GATEWAY_PORT || 8080}/users/ping`);
  const jobs = process.argv.includes('--regression-demo')
    ? [
      { args: ['scripts/check-trip-matching-integration.js'], transcript: 'trip-matching-regression.txt' },
      { args: ['scripts/check-driver-reject.js'], transcript: 'trip-matching-driver-reject.txt' },
      { args: ['scripts/check-trip-matching-phase3.js', '--demo'] },
    ]
    : [{ args: ['scripts/check-trip-matching-phase3.js', ...(process.argv.includes('--demo') ? ['--demo'] : [])] }];
  for (const job of jobs) {
    const transcript = job.transcript && path.join(root, 'docs/evidence/phase3', job.transcript);
    if (transcript) fs.writeFileSync(transcript, `Runtime: Docker tmpfs PostgreSQL/RabbitMQ/Redis + host Java/Node services\n`);
    const result = spawn(process.execPath, job.args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...env, PHASE3_RUNTIME: 'Docker tmpfs PostgreSQL/RabbitMQ/Redis + host Java/Node services' } });
    for (const stream of [result.stdout, result.stderr]) stream.on('data', chunk => { process.stdout.write(chunk); if (transcript) fs.appendFileSync(transcript, chunk); });
    const code = await new Promise((resolve, reject) => { result.on('error', reject); result.on('exit', resolve); });
    if (code !== 0) { process.exitCode = code || 1; break; }
  }
}
run().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  for (const { child } of processes) if (child.exitCode === null) child.kill();
  await new Promise(resolve => setTimeout(resolve, 1000));
  try { execFileSync('docker', [...composeArgs, 'down'], { cwd: root, stdio: 'inherit', timeout: 45000, windowsHide: true }); } catch (error) { console.error(`Infrastructure cleanup: ${error.message}`); }
});
