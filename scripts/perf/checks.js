'use strict';
// Điều kiện trước khi đo, kiểm tra số consumer, kiểm tra kết quả một lượt và chờ có hạn.

const QUEUES = {
  payment: 'payment-service.trip.completed',
  notification: 'notification-service.payment.succeeded',
  // Trip cũng nhận payment.*; với tripId giả nó retry rồi đẩy vào DLQ nên bị dừng khi đo.
  trip: ['trip-service.payment.succeeded', 'trip-service.payment.failed'],
  dlq: ['payment-service.trip.completed.dlq', 'notification-service.payment.succeeded.dlq'],
};

const REQUIRED_CONTAINERS = ['payment_service', 'notification_service', 'payment_postgres', 'notification_postgres', 'rabbitmq'];

function preflightProblems({ containers, queues, pendingOutbox }) {
  const problems = [];
  for (const name of REQUIRED_CONTAINERS) {
    const container = containers.find(c => c.name === name);
    if (!container || container.health !== 'healthy') {
      problems.push(`Container ${name} chưa healthy (trạng thái: ${container ? container.health : 'không có'})`);
    }
  }
  for (const name of [QUEUES.payment, QUEUES.notification]) {
    const queue = queues.find(q => q.name === name);
    if (!queue || !queue.exists) problems.push(`Queue ${name} chưa tồn tại; hãy chạy service tương ứng trước`);
  }
  for (const name of [QUEUES.payment, QUEUES.notification, ...QUEUES.trip]) {
    const queue = queues.find(q => q.name === name);
    if (queue && queue.exists && queue.messages > 0) {
      problems.push(`Queue ${name} còn ${queue.messages} message; hãy xử lý hoặc dọn trước khi đo`);
    }
  }
  if (pendingOutbox > 0) problems.push(`Payment outbox còn ${pendingOutbox} event chưa publish`);
  return problems;
}

function consumerProblems(actual, expected) {
  return actual === expected ? [] : [`Queue ${QUEUES.payment} có ${actual} consumer, cần ${expected} consumer`];
}

function runProblems({ expected, successCount, notifiedCount, dlqBefore, dlqAfter }) {
  const problems = [];
  if (successCount !== expected) problems.push(`Chỉ ${successCount}/${expected} payment ở trạng thái SUCCESS`);
  if (notifiedCount !== expected) problems.push(`Chỉ ${notifiedCount}/${expected} chuyến có thông báo`);
  for (const [name, before] of Object.entries(dlqBefore)) {
    const after = dlqAfter[name] ?? before;
    if (after > before) problems.push(`DLQ ${name} tăng từ ${before} lên ${after}`);
  }
  return problems;
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, { label, timeoutMs, intervalMs = 200, now = Date.now, sleep = defaultSleep }) {
  const started = now();
  for (;;) {
    if (await check()) return;
    if (now() - started >= timeoutMs) throw new Error(`Quá thời gian chờ (${Math.round(timeoutMs / 1000)} giây): ${label}`);
    await sleep(intervalMs);
  }
}

module.exports = { QUEUES, REQUIRED_CONTAINERS, preflightProblems, consumerProblems, runProblems, waitFor };
