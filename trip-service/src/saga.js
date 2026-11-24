'use strict';
const events = require('./events');
const driver = require('./service-client');
const { InvalidEvent } = require('./validation');
const log = require('./logger');
const vouchers = require('./vouchers');
async function history(client, trip, status, reason, paymentId = trip.paymentId, driverId = trip.driverId, rejectedDriverIds = trip.rejectedDriverIds || []) {
  const result = await client.query('UPDATE trips SET status=$2, "paymentId"=$3, "driverId"=$4, "rejectedDriverIds"=$6, version=version+1, "updatedAt"=CURRENT_TIMESTAMP WHERE "tripId"=$1 AND version=$5 RETURNING *', [trip.tripId, status, paymentId, driverId, trip.version, rejectedDriverIds]);
  if (result.rowCount !== 1) {
    const error = new Error('Trip was changed concurrently; reload and retry');
    error.status = 409;
    throw error;
  }
  await client.query('INSERT INTO trip_status_history ("tripId", previous_status, new_status, reason) VALUES ($1,$2,$3,$4)', [trip.tripId, trip.status, status, reason]);
  return result.rows[0];
}
async function payment(event) {
  await events.once(event, async client => {
    const p = event.payload;
    const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1', [p.tripId]);
    if (!trip) throw new Error('Trip not found');
    if (trip.passengerId !== p.riderId || (p.driverId && trip.driverId !== p.driverId) || Number(trip.fare) !== p.amount) throw new InvalidEvent('Payment does not match trip');
    if (event.eventType === 'payment.succeeded') {
      if (trip.status === 'CONFIRMED') return;
      if (trip.status !== 'PAYMENT_PENDING') throw new InvalidEvent(`Cannot confirm ${trip.status}`);
      await history(client, trip, 'CONFIRMED', 'payment succeeded', p.paymentId);
      await driver.request('DRIVER-SERVICE', `/internal/drivers/${trip.driverId}/complete-trip`, event.correlationId, { tripId: trip.tripId });
    } else {
      if (['CANCELLED', 'FAILED'].includes(trip.status)) return;
      if (trip.status !== 'PAYMENT_PENDING') throw new InvalidEvent(`Cannot compensate ${trip.status}`);
      await history(client, trip, 'CANCELLED', p.reason, p.paymentId);
      await vouchers.release(client, trip.tripId);
      await driver.release(trip.driverId, event.correlationId, trip.tripId);
      await events.enqueue(client, 'trip.compensated', { tripId: trip.tripId, riderId: trip.passengerId, driverId: trip.driverId, reason: p.reason, compensatedAt: new Date().toISOString() }, event.correlationId);
    }
    log('info', `Applied ${event.eventType}`, { correlationId: event.correlationId, eventId: event.eventId, tripId: p.tripId });
  });
}
async function assigned(event) {
  await events.once(event, async client => {
    const p = event.payload;
    const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1', [p.tripId]);
    if (!trip) throw new Error('Trip not found');
    if (trip.passengerId !== p.riderId) throw new InvalidEvent('Assignment rider mismatch');
    if (trip.driverId === p.driverId && !['CANCELLED', 'FAILED'].includes(trip.status)) return;
    if ((trip.rejectedDriverIds || []).includes(p.driverId) || !['REQUESTED', 'MATCHING'].includes(trip.status)) {
      await driver.request('DRIVER-SERVICE', `/internal/drivers/${p.driverId}/reject`, event.correlationId, { tripId: trip.tripId });
      return;
    }
    await history(client, trip, 'AWAITING_DRIVER', 'driver assigned', null, p.driverId);
  });
}
async function failed(event) {
  await events.once(event, async client => {
    const p = event.payload;
    const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1', [p.tripId]);
    if (!trip) throw new Error('Trip not found');
    if (trip.passengerId !== p.riderId) throw new InvalidEvent('Failure rider mismatch');
    if (!['REQUESTED', 'MATCHING'].includes(trip.status)) return;
    await history(client, trip, 'FAILED', p.reason, null, null);
    await vouchers.release(client, trip.tripId);
    await events.enqueue(client, 'trip.failed', { tripId: trip.tripId, riderId: trip.passengerId, reason: p.reason, failedAt: new Date().toISOString() }, event.correlationId);
  });
}
// Payment đã khoá được tiền (BANK) hoặc chấp nhận tiền mặt: chuyến mới được đưa sang ghép tài xế.
async function authorized(event) {
  await events.once(event, async client => {
    const p = event.payload;
    const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1', [p.tripId]);
    if (!trip) throw new Error('Trip not found');
    if (trip.passengerId !== p.riderId) throw new InvalidEvent('Authorization rider mismatch');
    if (trip.status !== 'REQUESTED') return;
    await history(client, trip, 'MATCHING', 'payment authorized', null, null);
    await events.enqueue(client, 'trip.matching_requested', { tripId: trip.tripId, riderId: trip.passengerId, pickup: trip.pickup, destination: trip.destination, vehicleType: trip.vehicleType || 'MOTORCYCLE', fareAmount: Number(trip.fare), requestedAt: new Date().toISOString() }, event.correlationId);
  });
}
// Không khoá được tiền (số dư không đủ): chuyến thất bại trước khi ghép, trả voucher, báo khách.
async function authorizationFailed(event) {
  await events.once(event, async client => {
    const p = event.payload;
    const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1', [p.tripId]);
    if (!trip) throw new Error('Trip not found');
    if (trip.passengerId !== p.riderId) throw new InvalidEvent('Authorization rider mismatch');
    if (trip.status !== 'REQUESTED') return;
    await history(client, trip, 'FAILED', p.reason, null, null);
    await vouchers.release(client, trip.tripId);
    await events.enqueue(client, 'trip.failed', { tripId: trip.tripId, riderId: trip.passengerId, reason: p.reason, failedAt: new Date().toISOString() }, event.correlationId);
  });
}
module.exports = { payment, assigned, failed, authorized, authorizationFailed, history };
