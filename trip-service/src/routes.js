'use strict';
const crypto = require('crypto');
const db = require('./db');
const events = require('./events');
const { history } = require('./saga');
const { uuid, money } = require('./validation');
const driver = require('./service-client');
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function location(p) { return p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180; }
module.exports = app => {
  app.post('/trips', async (req, res) => {
    const { riderId, pickup, destination, estimatedDistance, fareAmount } = req.body || {};
    if (!uuid(riderId) || !location(pickup) || !location(destination) || !Number.isFinite(estimatedDistance) || estimatedDistance < 0 || estimatedDistance > 99999999.99 || !money(fareAmount)) fail(400, 'Invalid riderId, locations, distance or fareAmount');
    const tripId = crypto.randomUUID();
    const trip = await events.transaction(async client => {
      const { rows: [row] } = await client.query('INSERT INTO trips ("tripId", "passengerId", pickup, destination, "estimatedDistance", fare, "sagaId") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [tripId, riderId, pickup, destination, estimatedDistance, fareAmount, req.correlationId]);
      await client.query('INSERT INTO trip_status_history ("tripId", new_status, reason) VALUES ($1,$2,$3)', [tripId, 'REQUESTED', 'trip requested']);
      await events.enqueue(client, 'trip.requested', { tripId, riderId, pickup, destination, fareAmount }, req.correlationId);
      return row;
    });
    res.status(201).json(trip);
  });
  app.get('/trips/:id', async (req, res) => {
    if (!uuid(req.params.id)) fail(400, 'Invalid tripId');
    const { rows: [trip] } = await db.query('SELECT * FROM trips WHERE "tripId"=$1', [req.params.id]);
    if (!trip) fail(404, 'Trip not found');
    res.json(trip);
  });
  // Tài xế từ chối chuyến: nhả tài xế ngay ở Driver Service, đưa chuyến về MATCHING
  // và phát trip.driver_rejected để Matching tìm tài xế khác.
  app.post('/trips/:id/reject', async (req, res) => {
    if (!uuid(req.params.id)) fail(400, 'Invalid tripId');
    const requesterId = req.get('x-user-id');
    if (!uuid(requesterId)) fail(401, 'Missing driver identity');
    const result = await events.transaction(async client => {
      const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1 FOR UPDATE', [req.params.id]);
      if (!trip) fail(404, 'Trip not found');
      const correlationId = trip.sagaId || req.correlationId;
      req.correlationId = correlationId;
      res.setHeader('X-Correlation-ID', correlationId);
      if (trip.status !== 'AWAITING_DRIVER') fail(409, 'Trip is not awaiting driver');
      if (trip.driverId !== requesterId.toLowerCase()) fail(403, 'Only the assigned driver can reject this trip');
      try { await driver.request('DRIVER-SERVICE', `/internal/drivers/${trip.driverId}/reject`, correlationId, { tripId: trip.tripId }); }
      catch (error) {
        // 404: tài xế không còn tồn tại nên không có gì để nhả; 400/409: tài xế đã bắt đầu chuyến.
        if ([400, 409].includes(error.status)) fail(409, 'Driver can no longer reject this trip');
        if (error.status !== 404) throw error;
      }
      await history(client, trip, 'MATCHING', 'driver rejected', trip.paymentId, null);
      await events.enqueue(client, 'trip.driver_rejected', { tripId: trip.tripId, riderId: trip.passengerId, driverId: trip.driverId, pickup: trip.pickup, rejectedAt: new Date().toISOString() }, correlationId);
      return { ...trip, driverId: null, status: 'MATCHING' };
    });
    res.json(result);
  });
  for (const action of ['start', 'complete']) app.post(`/trips/:id/${action}`, async (req, res) => {
    if (!uuid(req.params.id)) fail(400, 'Invalid tripId');
    const result = await events.transaction(async client => {
      const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1 FOR UPDATE', [req.params.id]);
      if (!trip) fail(404, 'Trip not found');
      const correlationId = trip.sagaId || req.correlationId;
      req.correlationId = correlationId;
      res.setHeader('X-Correlation-ID', correlationId);
      if (action === 'start') {
        if (trip.status === 'IN_PROGRESS') return trip;
        if (trip.status !== 'AWAITING_DRIVER') fail(409, 'Trip is not awaiting driver');
        await driver.request('DRIVER-SERVICE', `/internal/drivers/${trip.driverId}/start-trip`, correlationId);
        await history(client, trip, 'IN_PROGRESS', 'trip started');
        return { ...trip, status: 'IN_PROGRESS' };
      }
      if (['PAYMENT_PENDING', 'CONFIRMED'].includes(trip.status)) return trip;
      if (trip.status !== 'IN_PROGRESS') fail(409, 'Trip is not in progress');
      const fare = req.body?.fareAmount ?? Number(trip.fare);
      if (!money(fare)) fail(400, 'Invalid fareAmount');
      await client.query('UPDATE trips SET fare=$2 WHERE "tripId"=$1', [trip.tripId, fare]);
      await history(client, trip, 'PAYMENT_PENDING', 'trip completed; awaiting payment');
      await events.enqueue(client, 'trip.completed', { tripId: trip.tripId, riderId: trip.passengerId, driverId: trip.driverId, fareAmount: fare, completedAt: new Date().toISOString() }, correlationId);
      return { ...trip, fare, status: 'PAYMENT_PENDING' };
    });
    res.json(result);
  });
};
