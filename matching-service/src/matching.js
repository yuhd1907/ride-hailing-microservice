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
module.exports.prepare = async event => {
  await events.transaction(async client => {
    await client.query('INSERT INTO matching_requests ("tripId", status, "reservationId") VALUES ($1,$2,$3) ON CONFLICT ("tripId") DO NOTHING', [event.payload.tripId, 'PENDING', crypto.randomUUID()]);
    const { rows: [row] } = await client.query('SELECT * FROM matching_requests WHERE "tripId"=$1 FOR UPDATE', [event.payload.tripId]);
    if (['ASSIGNED', 'FAILED', 'CANCELLED'].includes(row.status) || row.selectedDriverId) return;
    const { pickup } = event.payload;
    const candidates = await driver.request('DRIVER-SERVICE', `/internal/drivers/available?lat=${pickup.lat}&lng=${pickup.lng}&radius=5`, event.correlationId, null, 'GET');
    const candidate = candidates.find(item => !row.attemptedDriverIds.includes(item.id));
    if (!candidate) {
      await client.query('UPDATE matching_requests SET status=$2, "selectedDriverId"=$3 WHERE "tripId"=$1', [event.payload.tripId, 'FAILED', null]);
      await events.enqueue(client, 'matching.failed', { tripId: event.payload.tripId, riderId: event.payload.riderId, reason: 'NO_AVAILABLE_DRIVERS', failedAt: new Date().toISOString() }, event.correlationId);
      return;
    }
    await client.query('UPDATE matching_requests SET "selectedDriverId"=$2 WHERE "tripId"=$1', [event.payload.tripId, candidate.id]);
  });
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
  // Conflicts consume candidates, not RabbitMQ's three transient-error retries.
  for (let attempt = 0; attempt < 100; attempt++) {
    await module.exports.prepare(event);
    try { await module.exports(event); return; }
    catch (error) {
      if (!error.reservationConflict) throw error;
      await events.transaction(async client => {
        await client.query('UPDATE matching_requests SET "attemptedDriverIds"=array_append("attemptedDriverIds", "selectedDriverId"), "selectedDriverId"=NULL, "reservationId"=$4 WHERE "tripId"=$1 AND status=$2 AND "selectedDriverId"=$3', [event.payload.tripId, 'PENDING', error.driverId, crypto.randomUUID()]);
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
