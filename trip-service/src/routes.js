'use strict';
const crypto = require('crypto');
const db = require('./db');
const events = require('./events');
const { history } = require('./saga');
const { uuid } = require('./validation');
const { actor, assignedDriver, fail } = require('./auth');
const pricing = require('./pricing');
const driver = require('./service-client');

async function findTrip(client, id) {
  if (!uuid(id)) fail(400, 'Invalid tripId');
  const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1', [id]);
  if (!trip) fail(404, 'Trip not found');
  return trip;
}

function correlation(req, res, trip) {
  req.correlationId = trip.sagaId || req.correlationId;
  res.setHeader('X-Correlation-ID', req.correlationId);
  return req.correlationId;
}

module.exports = app => {
  app.post('/trips/estimate', async (req, res) => {
    const riderId = actor(req, 'ROLE_PASSENGER');
    res.json(await pricing.quote(riderId, req.body, req.correlationId));
  });

  app.post('/trips', async (req, res) => {
    const riderId = actor(req, 'ROLE_PASSENGER');
    if (req.body?.riderId !== undefined && req.body.riderId?.toLowerCase?.() !== riderId) fail(403, 'Cannot book for another passenger');
    // Legacy clients may book directly; server issues a fresh quote for that request.
    // Clients displaying an estimate must send quoteId to lock the displayed fare.
    const quoteId = req.body?.quoteId !== undefined ? req.body.quoteId : (await pricing.quote(riderId, req.body, req.correlationId)).quoteId;
    const tripId = crypto.randomUUID();
    const trip = await events.transaction(async client => {
      const locked = await pricing.lockQuote(client, quoteId, riderId, req.body);
      if (locked.tripId) return findTrip(client, locked.tripId);
      const { pickup, destination, estimatedDistance, estimatedDuration, fareAmount, vehicleType } = locked.snapshot;
      const { rows: [row] } = await client.query('INSERT INTO trips ("tripId", "passengerId", pickup, destination, "estimatedDistance", fare, "sagaId", "vehicleType", "quoteId", "estimatedDuration", "pricingSnapshot") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [tripId, riderId, pickup, destination, estimatedDistance, fareAmount, req.correlationId, vehicleType, quoteId, estimatedDuration, locked.snapshot]);
      await client.query('UPDATE fare_quotes SET trip_id=$2 WHERE quote_id=$1', [quoteId, tripId]);
      await client.query('INSERT INTO trip_status_history ("tripId", new_status, reason) VALUES ($1,$2,$3)', [tripId, 'REQUESTED', 'trip requested']);
      await events.enqueue(client, 'trip.requested', { tripId, riderId, pickup, destination, estimatedDistance, fareAmount, vehicleType }, req.correlationId);
      return row;
    });
    res.status(201).json(trip);
  });

  app.get('/trips/:id', async (req, res) => {
    const userId = req.get('x-user-id');
    if (!uuid(userId)) fail(401, 'Missing authenticated identity');
    const trip = await findTrip(db, req.params.id);
    const roles = (req.get('x-user-roles') || '').split(',').map(value => value.trim());
    const passenger = roles.includes('ROLE_PASSENGER') && trip.passengerId === userId.toLowerCase();
    const assigned = roles.includes('ROLE_DRIVER') && trip.driverId === userId.toLowerCase();
    if (!passenger && !assigned) fail(403, 'Trip is not accessible to this user');
    res.json(trip);
  });

  app.post('/trips/:id/reject', async (req, res) => {
    actor(req, 'ROLE_DRIVER');
    const result = await events.transaction(async client => {
      const trip = await findTrip(client, req.params.id);
      assignedDriver(req, trip);
      const correlationId = correlation(req, res, trip);
      if (trip.status !== 'AWAITING_DRIVER') fail(409, 'Trip is not awaiting driver');
      const rejected = [...new Set([...(trip.rejectedDriverIds || []), trip.driverId])];
      const updated = await history(client, trip, 'MATCHING', 'driver rejected', trip.paymentId, null, rejected);
      try { await driver.request('DRIVER-SERVICE', `/internal/drivers/${trip.driverId}/reject`, correlationId, { tripId: trip.tripId }); }
      catch (error) {
        if ([400, 409].includes(error.status)) fail(409, 'Driver can no longer reject this trip');
        if (error.status !== 404) throw error;
      }
      await events.enqueue(client, 'trip.driver_rejected', { tripId: trip.tripId, riderId: trip.passengerId, driverId: trip.driverId, pickup: trip.pickup, vehicleType: trip.vehicleType || 'MOTORCYCLE', rejectedAt: new Date().toISOString() }, correlationId);
      return updated;
    });
    res.json(result);
  });

  app.post('/trips/:id/cancel', async (req, res) => {
    const riderId = actor(req, 'ROLE_PASSENGER');
    const result = await events.transaction(async client => {
      const trip = await findTrip(client, req.params.id);
      if (trip.passengerId !== riderId) fail(403, 'Only the passenger can cancel this trip');
      const correlationId = correlation(req, res, trip);
      if (trip.status === 'CANCELLED') return trip;
      if (!['REQUESTED', 'MATCHING', 'AWAITING_DRIVER'].includes(trip.status)) fail(409, 'Trip can no longer be cancelled');
      const updated = await history(client, trip, 'CANCELLED', 'passenger cancelled', trip.paymentId, null);
      if (trip.driverId) await driver.request('DRIVER-SERVICE', `/internal/drivers/${trip.driverId}/reject`, correlationId, { tripId: trip.tripId });
      await events.enqueue(client, 'trip.cancelled', { tripId: trip.tripId, riderId, driverId: trip.driverId, cancelledAt: new Date().toISOString() }, correlationId);
      return updated;
    });
    res.json(result);
  });

  // Accept starts the trip. /start remains an equally authorized alias.
  for (const action of ['accept', 'start', 'complete']) app.post(`/trips/:id/${action}`, async (req, res) => {
    actor(req, 'ROLE_DRIVER');
    const result = await events.transaction(async client => {
      const trip = await findTrip(client, req.params.id);
      assignedDriver(req, trip);
      const correlationId = correlation(req, res, trip);
      if (action !== 'complete') {
        if (trip.status === 'IN_PROGRESS') return trip;
        if (trip.status !== 'AWAITING_DRIVER') fail(409, 'Trip is not awaiting driver');
        const updated = await history(client, trip, 'IN_PROGRESS', 'driver accepted; trip started');
        await driver.request('DRIVER-SERVICE', `/internal/drivers/${trip.driverId}/start-trip`, correlationId, { tripId: trip.tripId });
        return updated;
      }
      if (['PAYMENT_PENDING', 'CONFIRMED'].includes(trip.status)) return trip;
      if (trip.status !== 'IN_PROGRESS') fail(409, 'Trip is not in progress');
      const updated = await history(client, trip, 'PAYMENT_PENDING', 'trip completed; awaiting payment');
      await events.enqueue(client, 'trip.completed', { tripId: trip.tripId, riderId: trip.passengerId, driverId: trip.driverId, fareAmount: Number(trip.fare), completedAt: new Date().toISOString() }, correlationId);
      return updated;
    });
    res.json(result);
  });
};
