'use strict';
const events = require('./events');
const driver = require('./service-client');
const { InvalidEvent } = require('./validation');
const log = require('./logger');
async function history(client, trip, status, reason, paymentId = trip.paymentId, driverId = trip.driverId) {
  await client.query('UPDATE trips SET status=$2, "paymentId"=$3, "driverId"=$4, version=version+1, "updatedAt"=CURRENT_TIMESTAMP WHERE "tripId"=$1', [trip.tripId, status, paymentId, driverId]);
  await client.query('INSERT INTO trip_status_history ("tripId", previous_status, new_status, reason) VALUES ($1,$2,$3,$4)', [trip.tripId, trip.status, status, reason]);
}
async function payment(event) {
  await events.once(event, async client => {
    const p = event.payload;
    const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1 FOR UPDATE', [p.tripId]);
    if (!trip) throw new Error('Trip not found');
    if (trip.passengerId !== p.riderId || (p.driverId && trip.driverId !== p.driverId) || Number(trip.fare) !== p.amount) throw new InvalidEvent('Payment does not match trip');
    if (event.eventType === 'payment.succeeded') {
      if (trip.status === 'CONFIRMED') return;
      if (trip.status !== 'PAYMENT_PENDING') throw new InvalidEvent(`Cannot confirm ${trip.status}`);
      await driver.request('DRIVER-SERVICE', `/internal/drivers/${trip.driverId}/complete-trip`, event.correlationId);
      await history(client, trip, 'CONFIRMED', 'payment succeeded', p.paymentId);
    } else {
      if (['CANCELLED', 'FAILED'].includes(trip.status)) return;
      if (trip.status !== 'PAYMENT_PENDING') throw new InvalidEvent(`Cannot compensate ${trip.status}`);
      await driver.release(trip.driverId, event.correlationId);
      await history(client, trip, 'CANCELLED', p.reason, p.paymentId);
      await events.enqueue(client, 'trip.compensated', { tripId: trip.tripId, riderId: trip.passengerId, driverId: trip.driverId, reason: p.reason, compensatedAt: new Date().toISOString() }, event.correlationId);
    }
    log('info', `Applied ${event.eventType}`, { correlationId: event.correlationId, eventId: event.eventId, tripId: p.tripId });
  });
}
async function assigned(event) {
  await events.once(event, async client => {
    const p = event.payload;
    const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1 FOR UPDATE', [p.tripId]);
    if (!trip) throw new Error('Trip not found');
    if (trip.passengerId !== p.riderId) throw new InvalidEvent('Assignment rider mismatch');
    if (trip.driverId === p.driverId) return;
    if (!['REQUESTED', 'MATCHING'].includes(trip.status)) throw new InvalidEvent(`Cannot assign ${trip.status}`);
    await history(client, trip, 'AWAITING_DRIVER', 'driver assigned', null, p.driverId);
  });
}
module.exports = { payment, assigned, history };
