'use strict';
// Tính năng cho tài xế và hỗ trợ: bản đồ nhu cầu, các bước trong chuyến (đã đến / đã đón),
// tài xế hủy khi khách không xuất hiện, đánh giá sao, chỉ số hoạt động, phiếu hỗ trợ.
// Đăng ký TRƯỚC routes.js để các đường dẫn cố định không bị /trips/:id bắt mất.
const crypto = require('crypto');
const db = require('./db');
const events = require('./events');
const { history } = require('./saga');
const { uuid } = require('./validation');
const { identity, actor, assignedDriver, canRead, fail } = require('./auth');
const { location, distanceKm } = require('./fare');
const { cellFor, surgeFor } = require('./pricing-policy');
const pricing = require('./pricing');
const driver = require('./service-client');
const vouchers = require('./vouchers');

const VEHICLE_TYPES = ['MOTORCYCLE', 'CAR_4_SEAT', 'CAR_7_SEAT'];
// Tài xế phải chờ ở điểm đón ít nhất chừng này giây mới được báo "khách không xuất hiện".
const NO_SHOW_WAIT_SECONDS = Number(process.env.NO_SHOW_WAIT_SECONDS || 120);
const DRIVER_CANCEL_REASONS = Object.freeze({
  PASSENGER_NO_SHOW: 'khách không xuất hiện',
  PASSENGER_REQUEST: 'khách yêu cầu hủy',
  VEHICLE_PROBLEM: 'xe gặp sự cố',
  SAFETY: 'lo ngại an toàn',
});
const RATING_TAGS = ['SAFE_DRIVING', 'FRIENDLY', 'CLEAN_VEHICLE', 'ON_TIME', 'GOOD_ROUTE', 'LATE', 'UNSAFE_DRIVING', 'RUDE', 'DIRTY_VEHICLE'];
const RATABLE = ['PAYMENT_PENDING', 'CONFIRMED', 'COMPLETED'];
const TICKET_CATEGORIES = ['PASSENGER_NO_SHOW', 'WRONG_LOCATION', 'WRONG_FARE', 'PAYMENT', 'SAFETY', 'DRIVER_BEHAVIOR', 'LOST_ITEM', 'ACCOUNT', 'OTHER'];
const DEMAND_RINGS = 3; // lưới 7 × 7 ô quanh tài xế
const RECENT_MINUTES = 30;

// Bỏ ký tự điều khiển, gộp khoảng trắng, cắt độ dài.
const clean = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

async function lockTrip(client, id) {
  if (!uuid(id)) fail(400, 'Invalid tripId');
  const { rows: [trip] } = await client.query('SELECT * FROM trips WHERE "tripId"=$1 FOR UPDATE', [id]);
  if (!trip) fail(404, 'Trip not found');
  return trip;
}

function correlation(req, res, trip) {
  req.correlationId = trip.sagaId || req.correlationId;
  res.setHeader('X-Correlation-ID', req.correlationId);
  return req.correlationId;
}

// Đổi bước trong chuyến đang chạy; status giữ IN_PROGRESS, lịch sử ghi một mốc để khách và tài xế cùng thấy.
async function setPhase(client, trip, phase, reason) {
  const { rows: [row], rowCount } = await client.query(`UPDATE trips SET "tripPhase"=$2::text,
      "arrivedAt"=COALESCE("arrivedAt", CURRENT_TIMESTAMP),
      "pickedUpAt"=CASE WHEN $2::text='ON_BOARD' THEN COALESCE("pickedUpAt", CURRENT_TIMESTAMP) ELSE "pickedUpAt" END,
      version=version+1, "updatedAt"=CURRENT_TIMESTAMP
    WHERE "tripId"=$1 AND version=$3 RETURNING *`, [trip.tripId, phase, trip.version]);
  if (rowCount !== 1) fail(409, 'Trip was changed concurrently; reload and retry');
  await client.query('INSERT INTO trip_status_history ("tripId", previous_status, new_status, reason) VALUES ($1,$2,$3,$4)', [trip.tripId, trip.status, trip.status, reason]);
  return row;
}

const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);

module.exports = app => {
  // ---------------------------------------------------------------- Bản đồ nhu cầu
  // Lưới ô quanh tài xế; mỗi ô tính hệ số nhu cầu bằng đúng công thức giá động (surgeFor):
  // số yêu cầu đang chờ / số tài xế rảnh trong bán kính surgeRadiusKm quanh tâm ô.
  app.get('/trips/demand-map', async (req, res) => {
    actor(req, 'ROLE_DRIVER');
    const center = { lat: Number(req.query.lat), lng: Number(req.query.lng) };
    if (!location(center)) fail(400, 'Invalid lat/lng');
    const vehicleType = req.query.vehicleType || 'MOTORCYCLE';
    if (!VEHICLE_TYPES.includes(vehicleType)) fail(400, 'Invalid vehicleType');
    const { config } = await pricing.policy();
    const size = config.cellSizeKm, radius = config.surgeRadiusKm;
    const latStep = size / 111.32;

    const cells = new Map();
    for (let i = -DEMAND_RINGS; i <= DEMAND_RINGS; i++) {
      for (let j = -DEMAND_RINGS; j <= DEMAND_RINGS; j++) {
        const lat = center.lat + i * latStep;
        const cell = cellFor({ lat, lng: center.lng + (j * latStep) / Math.cos((lat * Math.PI) / 180) }, size);
        cells.set(cell.id, cell);
      }
    }
    const reach = DEMAND_RINGS * size + radius + size;
    const latSpan = reach / 111.32, lngSpan = reach / (111.32 * Math.cos((center.lat * Math.PI) / 180));
    const { rows } = await db.query(`SELECT pickup, status FROM trips WHERE "vehicleType"=$1
        AND (status IN ('REQUESTED','MATCHING') OR "createdAt" >= CURRENT_TIMESTAMP - make_interval(mins => $6))
        AND (pickup->>'lat')::double precision BETWEEN $2 AND $3 AND (pickup->>'lng')::double precision BETWEEN $4 AND $5
      LIMIT 5000`, [vehicleType, center.lat - latSpan, center.lat + latSpan, center.lng - lngSpan, center.lng + lngSpan, RECENT_MINUTES]);
    const open = rows.filter(r => ['REQUESTED', 'MATCHING'].includes(r.status)).map(r => r.pickup);

    let drivers = [], supplyKnown = true;
    try {
      const list = await driver.request('DRIVER-SERVICE', `/internal/drivers/available?lat=${center.lat}&lng=${center.lng}&radius=${Math.min(50, reach)}`, req.correlationId, null, 'GET');
      drivers = (Array.isArray(list) ? list : []).filter(d => d.vehicleType === vehicleType && Number.isFinite(d.latitude) && Number.isFinite(d.longitude))
        .map(d => ({ lat: d.latitude, lng: d.longitude }));
    } catch (_) {
      supplyKnown = false; // không đếm được tài xế: vẫn trả nhu cầu, hệ số tính như không có tài xế rảnh
    }

    const recentByCell = new Map();
    for (const r of rows) {
      const id = cellFor(r.pickup, size).id;
      recentByCell.set(id, (recentByCell.get(id) || 0) + 1);
    }
    const lngStepOf = lat => latStep / Math.max(0.000001, Math.cos((lat * Math.PI) / 180));
    const result = [...cells.values()].map(cell => {
      const demand = open.filter(p => distanceKm(cell.center, p) <= radius).length;
      const supply = drivers.filter(p => distanceKm(cell.center, p) <= radius).length;
      const lngStep = lngStepOf(cell.center.lat);
      return {
        cellId: cell.id,
        center: cell.center,
        bounds: { north: cell.center.lat + latStep / 2, south: cell.center.lat - latStep / 2, east: cell.center.lng + lngStep / 2, west: cell.center.lng - lngStep / 2 },
        demand,
        availableDrivers: supply,
        recentRequests: recentByCell.get(cell.id) || 0,
        multiplier: surgeFor(demand, supply, config),
      };
    });
    res.json({
      vehicleType, cellSizeKm: size, radiusKm: radius, recentMinutes: RECENT_MINUTES, maxMultiplier: config.maxSurgeMultiplier,
      supplyKnown, generatedAt: new Date().toISOString(), cells: result,
    });
  });

  // ---------------------------------------------------------------- Chỉ số tài xế
  app.get('/trips/drivers/me/stats', async (req, res) => {
    const driverId = actor(req, 'ROLE_DRIVER');
    const days = Math.min(365, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
    // Nhận cuốc = chuyến có mốc AWAITING_DRIVER → IN_PROGRESS khi tài xế này đang được giao.
    // Từ chối / không phản hồi = chuyến có tài xế trong rejectedDriverIds.
    const { rows: [counts] } = await db.query(`WITH mine AS (
        SELECT t.status, t."cancelledBy", EXISTS (SELECT 1 FROM trip_status_history h WHERE h."tripId"=t."tripId"
          AND h.previous_status='AWAITING_DRIVER' AND h.new_status='IN_PROGRESS') AS accepted
        FROM trips t WHERE t."driverId"=$1 AND t."createdAt" >= CURRENT_TIMESTAMP - make_interval(days => $2))
      SELECT (SELECT count(*) FROM mine WHERE accepted)::int AS accepted,
        (SELECT count(*) FROM trips WHERE $1 = ANY("rejectedDriverIds") AND "createdAt" >= CURRENT_TIMESTAMP - make_interval(days => $2))::int AS declined,
        (SELECT count(*) FROM mine WHERE accepted AND "cancelledBy"='DRIVER')::int AS "driverCancelled",
        (SELECT count(*) FROM mine WHERE status IN ('PAYMENT_PENDING','CONFIRMED','COMPLETED'))::int AS completed`, [driverId, days]);
    const [{ rows: [rating] }, { rows: distribution }, { rows: tags }, { rows: recent }] = await Promise.all([
      db.query('SELECT count(*)::int AS count, round(avg(stars)::numeric, 2)::float AS average FROM trip_ratings WHERE "driverId"=$1', [driverId]),
      db.query('SELECT stars, count(*)::int AS count FROM trip_ratings WHERE "driverId"=$1 GROUP BY stars', [driverId]),
      db.query('SELECT tag, count(*)::int AS count FROM trip_ratings, unnest(tags) AS tag WHERE "driverId"=$1 GROUP BY tag ORDER BY count DESC', [driverId]),
      db.query('SELECT stars, tags, comment, "createdAt" FROM trip_ratings WHERE "driverId"=$1 ORDER BY "createdAt" DESC LIMIT 5', [driverId]),
    ]);
    res.json({
      days,
      ...counts,
      acceptanceRate: rate(counts.accepted, counts.accepted + counts.declined),
      cancellationRate: rate(counts.driverCancelled, counts.accepted),
      rating: {
        average: rating.average,
        count: rating.count,
        distribution: Object.fromEntries([1, 2, 3, 4, 5].map(s => [s, distribution.find(d => d.stars === s)?.count ?? 0])),
        tags,
        recent,
      },
    });
  });

  // Điểm đánh giá công khai của một tài xế (khách xem khi được ghép).
  app.get('/trips/drivers/:driverId/rating', async (req, res) => {
    identity(req);
    if (!uuid(req.params.driverId)) fail(400, 'Invalid driverId');
    const { rows: [row] } = await db.query('SELECT count(*)::int AS count, round(avg(stars)::numeric, 2)::float AS average FROM trip_ratings WHERE "driverId"=$1', [req.params.driverId.toLowerCase()]);
    res.json({ driverId: req.params.driverId.toLowerCase(), average: row.average, count: row.count });
  });

  // ---------------------------------------------------------------- Trung tâm trợ giúp
  app.get('/trips/support/tickets', async (req, res) => {
    const { userId } = identity(req);
    const { rows } = await db.query('SELECT * FROM support_tickets WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 50', [userId]);
    res.json(rows);
  });

  app.post('/trips/support/tickets', async (req, res) => {
    const viewer = identity(req);
    const role = viewer.roles.includes('ROLE_DRIVER') ? 'DRIVER' : viewer.roles.includes('ROLE_PASSENGER') ? 'PASSENGER' : null;
    if (!role) fail(403, 'Required role: ROLE_PASSENGER or ROLE_DRIVER');
    const category = req.body?.category;
    if (!TICKET_CATEGORIES.includes(category)) fail(400, 'Invalid category');
    const subject = clean(req.body?.subject, 120);
    const description = typeof req.body?.description === 'string' ? req.body.description.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 2000) : '';
    if (subject.length < 3) fail(400, 'Subject is too short');
    if (description.length < 10) fail(400, 'Description is too short');
    let tripId = null;
    if (req.body?.tripId != null && req.body.tripId !== '') {
      if (!uuid(req.body.tripId)) fail(400, 'Invalid tripId');
      const { rows: [trip] } = await db.query('SELECT * FROM trips WHERE "tripId"=$1', [req.body.tripId]);
      if (!trip) fail(404, 'Trip not found');
      canRead(viewer, trip);
      tripId = trip.tripId;
    }
    const { rows: [open] } = await db.query(`SELECT count(*)::int AS n FROM support_tickets WHERE "userId"=$1 AND "createdAt" >= CURRENT_TIMESTAMP - INTERVAL '1 day'`, [viewer.userId]);
    if (open.n >= 10) fail(429, 'Too many tickets today');
    const { rows: [ticket] } = await db.query(`INSERT INTO support_tickets (id, "userId", role, "tripId", category, subject, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [crypto.randomUUID(), viewer.userId, role, tripId, category, subject, description]);
    res.status(201).json(ticket);
  });

  // ---------------------------------------------------------------- Các bước trong chuyến
  // Nhận cuốc → (đang tới) → Đã đến điểm đón → Đã đón khách → Hoàn thành (routes.js).
  for (const [action, phase, reason] of [['arrived', 'ARRIVED', 'driver arrived at pickup'], ['pickup', 'ON_BOARD', 'passenger picked up']]) {
    app.post(`/trips/:id/${action}`, async (req, res) => {
      actor(req, 'ROLE_DRIVER');
      const result = await events.transaction(async client => {
        const trip = await lockTrip(client, req.params.id);
        assignedDriver(req, trip);
        correlation(req, res, trip);
        if (trip.status !== 'IN_PROGRESS') fail(409, 'Trip is not in progress');
        if (trip.tripPhase === 'ON_BOARD' || trip.tripPhase === phase) return trip;
        return setPhase(client, trip, phase, reason);
      });
      res.json(result);
    });
  }

  // Tài xế hủy sau khi nhận cuốc (trước khi khách lên xe). Báo khách không xuất hiện phải chờ đủ thời gian ở điểm đón.
  app.post('/trips/:id/driver-cancel', async (req, res) => {
    actor(req, 'ROLE_DRIVER');
    const reason = req.body?.reason;
    if (!Object.hasOwn(DRIVER_CANCEL_REASONS, reason ?? '')) fail(400, 'Invalid cancel reason');
    const result = await events.transaction(async client => {
      const trip = await lockTrip(client, req.params.id);
      assignedDriver(req, trip);
      const correlationId = correlation(req, res, trip);
      if (trip.status === 'CANCELLED' && trip.cancelledBy === 'DRIVER') return trip;
      if (trip.status !== 'IN_PROGRESS') fail(409, 'Trip is not in progress');
      if (trip.tripPhase === 'ON_BOARD') fail(409, 'Passenger is already on board');
      if (reason === 'PASSENGER_NO_SHOW') {
        if (trip.tripPhase !== 'ARRIVED' || !trip.arrivedAt) fail(409, 'Mark arrival at pickup first');
        if (Date.now() - new Date(trip.arrivedAt).getTime() < NO_SHOW_WAIT_SECONDS * 1000) fail(409, 'Wait at pickup before reporting no-show');
      }
      const updated = await history(client, trip, 'CANCELLED', `driver cancelled: ${DRIVER_CANCEL_REASONS[reason]}`);
      const { rows: [row] } = await client.query('UPDATE trips SET "cancelledBy"=$2, "cancelReason"=$3 WHERE "tripId"=$1 RETURNING *', [trip.tripId, 'DRIVER', reason]);
      // Chuyến không thực hiện: trả voucher khách đã dùng, như khi khách hủy.
      await vouchers.release(client, trip.tripId);
      // Trả tài xế về AVAILABLE; Payment mở khoản đã khóa và Matching đóng yêu cầu khi nhận trip.cancelled.
      await driver.release(trip.driverId, correlationId, trip.tripId);
      await events.enqueue(client, 'trip.cancelled', { tripId: trip.tripId, riderId: trip.passengerId, driverId: trip.driverId, cancelledAt: new Date().toISOString() }, correlationId);
      return row ?? updated;
    });
    res.json(result);
  });

  // ---------------------------------------------------------------- Vị trí tài xế cho khách
  // Khách của chuyến (hoặc chính tài xế) xem vị trí GPS gần nhất của tài xế khi đang chờ / đang chạy.
  // Driver Service không mở vị trí ra ngoài; Trip Service kiểm tra quyền theo chuyến rồi mới hỏi nội bộ.
  app.get('/trips/:id/driver-location', async (req, res) => {
    const viewer = identity(req);
    if (!uuid(req.params.id)) fail(400, 'Invalid tripId');
    const { rows: [trip] } = await db.query('SELECT * FROM trips WHERE "tripId"=$1', [req.params.id]);
    if (!trip) fail(404, 'Trip not found');
    canRead(viewer, trip);
    if (!trip.driverId || !['AWAITING_DRIVER', 'IN_PROGRESS'].includes(trip.status)) fail(409, 'Driver location is not available for this trip');
    let location;
    try {
      location = await driver.request('DRIVER-SERVICE', `/internal/drivers/${trip.driverId}/location`, req.correlationId, null, 'GET');
    } catch (error) {
      if (error.status === 404) fail(404, 'Driver has not shared a location yet');
      throw error;
    }
    const position = { lat: location.latitude, lng: location.longitude };
    // Đang tới đón: đích là điểm đón; khách đã lên xe: đích là điểm đến.
    const target = trip.tripPhase === 'ON_BOARD' ? 'DESTINATION' : 'PICKUP';
    const remainingKm = distanceKm(position, target === 'PICKUP' ? trip.pickup : trip.destination);
    // Ước tính thô khi chưa có lộ trình thật: đường đi dài hơn đường chim bay ~30%, tốc độ nội đô trung bình.
    const speedKph = (trip.vehicleType || 'MOTORCYCLE') === 'MOTORCYCLE' ? 25 : 20;
    res.json({
      tripId: trip.tripId,
      driverId: trip.driverId,
      position,
      updatedAt: location.updatedAt,
      stale: !!location.stale,
      target,
      remainingKm: Math.round(remainingKm * 100) / 100,
      etaMinutes: Math.max(1, Math.round((remainingKm * 1.3 / speedKph) * 60)),
    });
  });

  // ---------------------------------------------------------------- Đánh giá
  app.get('/trips/:id/rating', async (req, res) => {
    const viewer = identity(req);
    if (!uuid(req.params.id)) fail(400, 'Invalid tripId');
    const { rows: [trip] } = await db.query('SELECT * FROM trips WHERE "tripId"=$1', [req.params.id]);
    if (!trip) fail(404, 'Trip not found');
    canRead(viewer, trip);
    const { rows: [rating] } = await db.query('SELECT * FROM trip_ratings WHERE "tripId"=$1', [trip.tripId]);
    res.json(rating ?? null);
  });

  app.post('/trips/:id/rating', async (req, res) => {
    const riderId = actor(req, 'ROLE_PASSENGER');
    if (!uuid(req.params.id)) fail(400, 'Invalid tripId');
    const stars = req.body?.stars;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail(400, 'Stars must be an integer from 1 to 5');
    const tags = Array.isArray(req.body?.tags) ? [...new Set(req.body.tags)] : [];
    if (tags.length > 5 || tags.some(t => !RATING_TAGS.includes(t))) fail(400, 'Invalid rating tags');
    const comment = clean(req.body?.comment, 500) || null;
    const { rows: [trip] } = await db.query('SELECT * FROM trips WHERE "tripId"=$1', [req.params.id]);
    if (!trip) fail(404, 'Trip not found');
    if (trip.passengerId !== riderId) fail(403, 'Only the passenger can rate this trip');
    if (!RATABLE.includes(trip.status) || !trip.driverId) fail(409, 'Trip cannot be rated yet');
    const { rows: [rating] } = await db.query(`INSERT INTO trip_ratings ("tripId", "passengerId", "driverId", stars, tags, comment)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("tripId") DO NOTHING RETURNING *`, [trip.tripId, riderId, trip.driverId, stars, tags, comment]);
    if (!rating) fail(409, 'Trip already rated');
    res.status(201).json(rating);
  });
};

module.exports.DRIVER_CANCEL_REASONS = DRIVER_CANCEL_REASONS;
module.exports.RATING_TAGS = RATING_TAGS;
module.exports.TICKET_CATEGORIES = TICKET_CATEGORIES;
