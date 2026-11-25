'use strict';
const crypto = require('crypto');
const events = require('./events');
const driver = require('./service-client');
module.exports = async event => {
  await events.once(event, async client => {
    const { tripId, riderId } = event.payload;
    // Persist reservation identity before external calls so a retry after a crash
    // repeats the same idempotent reserve, even if the driver disappeared from GEO.
    const { rows: [row] } = await client.query('SELECT * FROM matching_requests WHERE "tripId"=$1 FOR UPDATE', [tripId]);
    if (!row) throw new Error('Matching request not prepared');
    if (['ASSIGNED', 'FAILED', 'CANCELLED'].includes(row.status)) return;
    const driverId = row.selectedDriverId;
    if (!driverId) throw new Error('No selected driver; retry preparation');
    try {
      await driver.request('DRIVER-SERVICE', `/internal/drivers/${driverId}/reserve`, event.correlationId, { tripId, reservationId: row.reservationId });
    } catch (error) {
      if ([404, 409].includes(error.status)) {
        error.reservationConflict = true;
        error.driverId = driverId;
      }
      throw error;
    }
    await client.query('UPDATE matching_requests SET status=$2, "selectedDriverId"=$3, "attemptCount"="attemptCount"+1, "attemptedDriverIds"=array_append("attemptedDriverIds",$3::uuid) WHERE "tripId"=$1', [tripId, 'ASSIGNED', driverId]);
    await events.enqueue(client, 'matching.driver_assigned', { tripId, riderId, driverId, reservationId: row.reservationId, assignedAt: new Date().toISOString() }, event.correlationId);
  });
};
// Thời gian tối đa tìm tài xế cho một chuyến, tính từ lúc Matching nhận yêu cầu. Trong thời gian này,
// không có tài xế phù hợp thì chờ rồi tìm lại; quá hạn mới báo matching.failed để Trip hủy chuyến.
const SEARCH_TIMEOUT_MS = Number(process.env.MATCHING_SEARCH_TIMEOUT_SECONDS || 180) * 1000;
const RETRY_SECONDS = Number(process.env.MATCHING_RETRY_SECONDS || 5);
module.exports.SEARCH_TIMEOUT_MS = SEARCH_TIMEOUT_MS;

// Trả về 'selected' (đã chọn tài xế để giữ), 'waiting' (chưa có tài xế, sẽ tìm lại) hoặc 'closed'.
// busy: tài xế vừa báo bận (đang được giữ cho chuyến khác) trong lượt này; chỉ bỏ qua lượt này,
// lượt sau vẫn thử lại. Tài xế đã từ chối chuyến (attemptedDriverIds) thì không ghép lại.
module.exports.prepare = async (event, busy = new Set()) => events.transaction(async client => {
  const { tripId, riderId, pickup, destination, vehicleType } = event.payload;
  // Lưu ngữ cảnh để bộ tìm lại định kỳ dựng lại yêu cầu mà không cần event gốc.
  const context = { correlationId: event.correlationId, payload: { tripId, riderId, pickup, destination, vehicleType } };
  await client.query('INSERT INTO matching_requests ("tripId", status, "reservationId", context) VALUES ($1,$2,$3,$4) ON CONFLICT ("tripId") DO NOTHING', [tripId, 'PENDING', crypto.randomUUID(), context]);
  const { rows: [row] } = await client.query('SELECT * FROM matching_requests WHERE "tripId"=$1 FOR UPDATE', [tripId]);
  if (['ASSIGNED', 'FAILED', 'CANCELLED'].includes(row.status)) return 'closed';
  if (row.selectedDriverId) return 'selected';
  const candidates = await driver.request('DRIVER-SERVICE', `/internal/drivers/available?lat=${pickup.lat}&lng=${pickup.lng}&radius=5`, event.correlationId, null, 'GET');
  // Chỉ ghép đúng loại xe khách chọn; event cũ không có vehicleType thì ghép mọi loại.
  const candidate = candidates.find(item => !row.attemptedDriverIds.includes(item.id) && !busy.has(item.id) && (!vehicleType || item.vehicleType === vehicleType));
  if (candidate) {
    await client.query('UPDATE matching_requests SET "selectedDriverId"=$2 WHERE "tripId"=$1', [tripId, candidate.id]);
    return 'selected';
  }
  const startedAt = row.searchStartedAt ? new Date(row.searchStartedAt).getTime() : Date.now();
  if (Date.now() - startedAt < SEARCH_TIMEOUT_MS) {
    await client.query('UPDATE matching_requests SET "nextAttemptAt"=CURRENT_TIMESTAMP + make_interval(secs => $2), context=COALESCE(context, $3) WHERE "tripId"=$1', [tripId, RETRY_SECONDS, context]);
    return 'waiting';
  }
  await client.query('UPDATE matching_requests SET status=$2, "selectedDriverId"=$3 WHERE "tripId"=$1', [tripId, 'FAILED', null]);
  await events.enqueue(client, 'matching.failed', { tripId, riderId, reason: 'NO_AVAILABLE_DRIVERS', failedAt: new Date().toISOString() }, event.correlationId);
  return 'closed';
});

// Bộ tìm lại định kỳ: các yêu cầu đang chờ (chưa có tài xế) tới lượt thì chạy lại handle với ngữ cảnh đã lưu.
module.exports.retryWaiting = async (limit = 20) => {
  const rows = await events.transaction(async client => (await client.query(
    'SELECT "tripId", context FROM matching_requests WHERE status=$1 AND "selectedDriverId" IS NULL AND context IS NOT NULL AND "nextAttemptAt" <= CURRENT_TIMESTAMP ORDER BY "nextAttemptAt" LIMIT $2',
    ['PENDING', limit])).rows);
  for (const { context } of rows) {
    const event = { eventId: crypto.randomUUID(), eventType: 'matching.retry', correlationId: context.correlationId, occurredAt: new Date().toISOString(), payload: context.payload };
    try { await module.exports.handle(event); }
    catch (error) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', service: 'matching-service', correlationId: context.correlationId, tripId: context.payload.tripId, message: `Matching retry failed: ${error.message}` })); }
  }
  return rows.length;
};
// Tài xế từ chối chuyến: hủy lượt ghép cũ rồi ghép lại. Điều kiện ASSIGNED + đúng tài xế
// làm bước hủy lũy đẳng, nên message gửi lại không phá lượt ghép mới.
module.exports.rejected = async event => {
  const { tripId, driverId } = event.payload;
  await events.transaction(async client => {
    await client.query('UPDATE matching_requests SET status=$3, "selectedDriverId"=NULL, "reservationId"=$4, "attemptedDriverIds"=CASE WHEN $2::uuid = ANY("attemptedDriverIds") THEN "attemptedDriverIds" ELSE array_append("attemptedDriverIds", $2::uuid) END WHERE "tripId"=$1 AND status=$5 AND "selectedDriverId"=$2', [tripId, driverId, 'PENDING', crypto.randomUUID(), 'ASSIGNED']);
  });
  await module.exports.handle(event);
};
module.exports.handle = async event => {
  // Tài xế bận (409/404 khi giữ) chỉ bị bỏ qua trong lượt này, không tính vào số lần retry của RabbitMQ.
  const busy = new Set();
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await module.exports.prepare(event, busy);
    if (state === 'waiting' || state === 'closed') return;
    try { await module.exports(event); return; }
    catch (error) {
      if (!error.reservationConflict) throw error;
      busy.add(error.driverId);
      await events.transaction(async client => {
        await client.query('UPDATE matching_requests SET "selectedDriverId"=NULL, "reservationId"=$4 WHERE "tripId"=$1 AND status=$2 AND "selectedDriverId"=$3', [event.payload.tripId, 'PENDING', error.driverId, crypto.randomUUID()]);
      });
    }
  }
  throw new Error('Too many reservation conflicts; retry matching');
};

module.exports.cancelled = async event => {
  await events.once(event, async client => {
    const { tripId } = event.payload;
    // A tombstone also handles cancellation arriving before trip.requested.
    await client.query('INSERT INTO matching_requests ("tripId", status, "reservationId") VALUES ($1,$2,$3) ON CONFLICT ("tripId") DO NOTHING', [tripId, 'CANCELLED', crypto.randomUUID()]);
    const { rows: [row] } = await client.query('SELECT * FROM matching_requests WHERE "tripId"=$1 FOR UPDATE', [tripId]);
    if (row.selectedDriverId) await driver.request('DRIVER-SERVICE', `/internal/drivers/${row.selectedDriverId}/reject`, event.correlationId, { tripId });
    await client.query('UPDATE matching_requests SET status=$2, "selectedDriverId"=$3 WHERE "tripId"=$1', [tripId, 'CANCELLED', null]);
  });
};
