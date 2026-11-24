'use strict';
const crypto = require('crypto');
const db = require('./db');
const events = require('./events');
const { history } = require('./saga');
const { uuid } = require('./validation');
const { identity, actor, assignedDriver, canRead, fail } = require('./auth');
const { point, VEHICLES } = require('./fare');
const pricing = require('./pricing');
const driver = require('./service-client');
const vouchers = require('./vouchers');

const PAYMENT_METHODS = ['BANK', 'CASH'];
const TRIP_STATUSES = ['REQUESTED', 'MATCHING', 'AWAITING_DRIVER', 'IN_PROGRESS', 'PAYMENT_PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'FAILED'];

// Quote chỉ lưu tọa độ và địa chỉ đã làm sạch; chuyến lấy pickup/destination từ quote.
const quoteInput = (body, vehicleType = body?.vehicleType ?? undefined) => ({ pickup: point(body?.pickup), destination: point(body?.destination), vehicleType });

// Gắn giảm giá của voucher (nếu khách nhập mã) vào một quote: fareAmount là giá cuối khách trả.
function withVoucher(quote, voucher, code) {
  if (!code) return quote;
  const originalFare = Number(quote.fareAmount);
  const discount = vouchers.discountFor(voucher, originalFare, quote.vehicleType);
  return { ...quote, originalFare, discountAmount: discount.discountAmount, fareAmount: originalFare - discount.discountAmount,
    voucherCode: code, voucherApplicable: discount.applicable, voucherReason: discount.reason };
}

async function voucherFor(client, riderId, code) {
  return code ? (await vouchers.available(client, riderId)).find(v => v.code === code) || null : null;
}

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
  // Có vehicleType: một quote, client gửi lại quoteId khi đặt để khóa giá.
  // Không có (web chọn xe sau): quote cho mọi loại xe trong options; phần ngoài là quote xe máy.
  app.post('/trips/estimate', async (req, res) => {
    const riderId = actor(req, 'ROLE_PASSENGER');
    const code = vouchers.normalize(req.body?.voucherCode);
    const voucher = await voucherFor(db, riderId, code);
    if (req.body?.vehicleType != null) return res.json(withVoucher(await pricing.quote(riderId, quoteInput(req.body), req.correlationId), voucher, code));
    const options = await Promise.all(VEHICLES.map(async ({ vehicleType, displayName, seats }) =>
      ({ ...withVoucher(await pricing.quote(riderId, quoteInput(req.body, vehicleType), req.correlationId), voucher, code), displayName, seats })));
    res.json({ ...options[0], options });
  });

  // Các route cố định phải đứng trước /trips/:id, nếu không "me" bị hiểu là mã chuyến.
  app.get('/trips/fare-rates', async (req, res) => {
    identity(req);
    res.json(await pricing.rates());
  });

  // Voucher hành khách còn dùng được (còn hạn, chưa dùng).
  app.get('/trips/vouchers', async (req, res) => {
    const riderId = actor(req, 'ROLE_PASSENGER');
    res.json(await vouchers.available(db, riderId));
  });

  // Hành khách: chuyến mình đặt. Tài xế: chuyến được giao cho mình. Mới nhất trước, tối đa 100.
  app.get('/trips/me', async (req, res) => {
    const { userId, roles } = identity(req);
    const column = roles.includes('ROLE_PASSENGER') ? 'passengerId' : roles.includes('ROLE_DRIVER') ? 'driverId' : null;
    if (!column) fail(403, 'Required role: ROLE_PASSENGER or ROLE_DRIVER');
    const status = req.query.status || null;
    if (status !== null && !TRIP_STATUSES.includes(status)) fail(400, 'Invalid status');
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const args = [userId];
    let sql = `SELECT * FROM trips WHERE "${column}"=$1`;
    if (status) { args.push(status); sql += ' AND status=$2'; }
    args.push(limit);
    sql += ` ORDER BY "createdAt" DESC LIMIT $${args.length}`;
    const { rows } = await db.query(sql, args);
    res.json(rows);
  });

  app.post('/trips', async (req, res) => {
    const riderId = actor(req, 'ROLE_PASSENGER');
    if (req.body?.riderId !== undefined && req.body.riderId?.toLowerCase?.() !== riderId) fail(403, 'Cannot book for another passenger');
    const paymentMethod = req.body?.paymentMethod ?? 'BANK';
    if (!PAYMENT_METHODS.includes(paymentMethod)) fail(400, 'Invalid paymentMethod');
    const voucherCode = vouchers.normalize(req.body?.voucherCode);
    // Legacy clients may book directly; server issues a fresh quote for that request.
    // Clients displaying an estimate must send quoteId to lock the displayed fare.
    const quoteId = req.body?.quoteId !== undefined ? req.body.quoteId : (await pricing.quote(riderId, quoteInput(req.body), req.correlationId)).quoteId;
    const tripId = crypto.randomUUID();
    const trip = await events.transaction(async client => {
      const locked = await pricing.lockQuote(client, quoteId, riderId, req.body);
      if (locked.tripId) return findTrip(client, locked.tripId);
      const { pickup, destination, estimatedDistance, estimatedDuration, vehicleType } = locked.snapshot;
      const originalFare = Number(locked.snapshot.fareAmount);
      let discountAmount = 0;
      if (voucherCode) {
        const discount = vouchers.discountFor(await voucherFor(client, riderId, voucherCode), originalFare, vehicleType);
        if (!discount.applicable) fail(409, `Voucher không áp dụng được (${discount.reason})`);
        discountAmount = discount.discountAmount;
      }
      const fareAmount = originalFare - discountAmount;
      const { rows: [row] } = await client.query('INSERT INTO trips ("tripId", "passengerId", pickup, destination, "estimatedDistance", fare, "sagaId", "vehicleType", "quoteId", "estimatedDuration", "pricingSnapshot", "paymentMethod", "originalFare", "discountAmount", "voucherCode") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *', [tripId, riderId, pickup, destination, estimatedDistance, fareAmount, req.correlationId, vehicleType, quoteId, estimatedDuration, locked.snapshot, paymentMethod, originalFare, discountAmount, voucherCode]);
      if (voucherCode) await vouchers.redeem(client, voucherCode, riderId, tripId);
      await client.query('UPDATE fare_quotes SET trip_id=$2 WHERE quote_id=$1', [quoteId, tripId]);
      await client.query('INSERT INTO trip_status_history ("tripId", new_status, reason) VALUES ($1,$2,$3)', [tripId, 'REQUESTED', 'trip requested']);
      await events.enqueue(client, 'trip.requested', { tripId, riderId, pickup, destination, estimatedDistance, fareAmount, vehicleType, paymentMethod, voucherCode, originalFare, discountAmount }, req.correlationId);
      return row;
    });
    res.status(201).json(trip);
  });

  app.get('/trips/:id', async (req, res) => {
    const viewer = identity(req);
    const trip = await findTrip(db, req.params.id);
    canRead(viewer, trip);
    res.json(trip);
  });

  // Các mốc trạng thái của chuyến, cũ nhất trước; cùng quyền đọc như GET /trips/:id.
  app.get('/trips/:id/history', async (req, res) => {
    const viewer = identity(req);
    const trip = await findTrip(db, req.params.id);
    canRead(viewer, trip);
    const { rows } = await db.query('SELECT previous_status AS "previousStatus", new_status AS status, reason, "createdAt" FROM trip_status_history WHERE "tripId"=$1 ORDER BY "createdAt", id', [trip.tripId]);
    res.json(rows);
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
      await vouchers.release(client, trip.tripId);
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
        // Chỉ phát ở lần chuyển trạng thái thật; gọi lại khi đã IN_PROGRESS đã return ở trên.
        await events.enqueue(client, 'trip.accepted', { tripId: trip.tripId, riderId: trip.passengerId, driverId: trip.driverId, acceptedAt: new Date().toISOString() }, correlationId);
        return updated;
      }
      if (['PAYMENT_PENDING', 'CONFIRMED'].includes(trip.status)) return trip;
      if (trip.status !== 'IN_PROGRESS') fail(409, 'Trip is not in progress');
      const updated = await history(client, trip, 'PAYMENT_PENDING', 'trip completed; awaiting payment');
      await events.enqueue(client, 'trip.completed', { tripId: trip.tripId, riderId: trip.passengerId, driverId: trip.driverId, fareAmount: Number(trip.fare), completedAt: new Date().toISOString(), paymentMethod: trip.paymentMethod || 'BANK' }, correlationId);
      return updated;
    });
    res.json(result);
  });
};
