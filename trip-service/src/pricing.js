'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fail } = require('./auth');
const { uuid } = require('./validation');
const { location, VEHICLES } = require('./fare');
const { validatePolicy, cellFor, surgeFor, calculate } = require('./pricing-policy');
const { createProviders } = require('./pricing-providers');

const POLICY_SQL = `SELECT config,
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY vehicle_type) FROM fare_rates r) AS rates,
  COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY holiday_date) FROM pricing_holidays h WHERE enabled), '[]'::jsonb) AS holidays,
  COALESCE((SELECT jsonb_agg(to_jsonb(z) ORDER BY code) FROM pricing_zones z WHERE enabled), '[]'::jsonb) AS zones
  FROM pricing_rules WHERE id='default'`;
const DEMAND_SQL = `SELECT COUNT(*)::int AS demand FROM trips
  WHERE status IN ('REQUESTED','MATCHING') AND "vehicleType"=$1
  AND (pickup->>'lat')::double precision BETWEEN $2-$4/111.0 AND $2+$4/111.0
  AND 6371 * acos(least(1.0, greatest(-1.0,
    sin(radians($2)) * sin(radians((pickup->>'lat')::double precision)) +
    cos(radians($2)) * cos(radians((pickup->>'lat')::double precision)) *
    cos(radians((pickup->>'lng')::double precision - $3))))) <= $4`;
const ACTIVE_CELLS = 'pricing:active-cells';
const RELEASE_LOCK = "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";

function createPricing({ db, cache, driver, providers = createProviders(), now = () => new Date(), log = () => {} }) {
  let policy, policyUntil = 0, timer, stopped = true, ticking = false;
  async function getPolicy() {
    if (policy && now().getTime() < policyUntil) return policy;
    const { rows: [row] } = await db.query(POLICY_SQL);
    validatePolicy(row);
    row.revision = crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0, 16);
    policy = row;
    policyUntil = now().getTime() + 30000;
    return row;
  }
  async function readSurge(pickup, vehicleType, rules) {
    const cell = cellFor(pickup, rules.config.cellSizeKm);
    try {
      if (!cache.isReady) throw new Error('Redis not ready');
      await cache.zAdd(ACTIVE_CELLS, { score: now().getTime(), value: JSON.stringify({ ...cell, vehicleType }) });
      const value = await cache.get(`pricing:surge:${rules.revision}:${vehicleType}:${cell.id}`);
      const snapshot = value && JSON.parse(value);
      if (snapshot && Number.isFinite(snapshot.multiplier) && snapshot.multiplier >= 1 && snapshot.multiplier <= 2
        && now().getTime() - Date.parse(snapshot.updatedAt) < rules.config.surgeCacheSeconds * 1000) return { ...snapshot, cellId: cell.id, status: 'available' };
      return { multiplier: 1, cellId: cell.id, status: 'warming_up' };
    } catch (_) {
      return { multiplier: 1, cellId: cell.id, status: 'unavailable' };
    }
  }
  async function readWeather(pickup, rules) {
    const cell = cellFor(pickup, rules.config.cellSizeKm);
    const key = `pricing:weather:${cell.id}`;
    try {
      if (cache.isReady) {
        const stored = await cache.get(key);
        if (stored) return JSON.parse(stored);
      }
    } catch (_) { /* Weather remains optional if Redis is unavailable. */ }
    const weather = await providers.weather(pickup);
    try { if (cache.isReady && weather.status === 'available') await cache.set(key, JSON.stringify(weather), { EX: 300 }); }
    catch (_) { /* Do not fail a quote because an optional cache write failed. */ }
    return weather;
  }
  async function quote(passengerId, body, correlationId) {
    const { pickup, destination, vehicleType = 'MOTORCYCLE' } = body || {};
    if (!location(pickup) || !location(destination)) fail(400, 'Invalid pickup or destination');
    if (!['MOTORCYCLE', 'CAR_4_SEAT', 'CAR_7_SEAT'].includes(vehicleType)) fail(400, 'Invalid vehicleType');
    const rules = await getPolicy();
    const rate = rules.rates.find(r => r.vehicle_type === vehicleType);
    if (!rate) fail(400, 'Vehicle type has no fare rate');
    const [route, surge, weather] = await Promise.all([
      providers.route(pickup, destination, vehicleType, rules.config), readSurge(pickup, vehicleType, rules), readWeather(pickup, rules),
    ]);
    if (!Number.isFinite(route.distanceKm) || route.distanceKm < 0 || !Number.isFinite(route.durationMinutes) || route.durationMinutes < 0) throw new Error('Invalid route metrics');
    const createdAt = now();
    const snapshot = { ...calculate(rules, rate, pickup, route, surge, weather, createdAt),
      quoteId: crypto.randomUUID(), pickup, destination, vehicleType,
      pricingRevision: rules.revision, distanceSource: route.source, surge, weather,
      notices: [route.source === 'straight_line_estimate' ? 'DISTANCE_AND_DURATION_ESTIMATED' : null,
        surge.status !== 'available' ? `SURGE_${surge.status.toUpperCase()}` : null,
        weather.status !== 'available' ? `WEATHER_${weather.status.toUpperCase()}` : null].filter(Boolean),
    };
    // PostgreSQL owns quote validity so replicas with clock skew agree on expiry.
    const { rows: [stored] } = await db.query(`WITH validity AS (SELECT clock_timestamp() AS issued_at)
      INSERT INTO fare_quotes (quote_id, passenger_id, snapshot, expires_at, created_at)
      SELECT $1,$2,$3::jsonb || jsonb_build_object('createdAt', issued_at, 'expiresAt', issued_at + $4 * INTERVAL '1 second'),
        issued_at + $4 * INTERVAL '1 second', issued_at FROM validity RETURNING snapshot`,
    [snapshot.quoteId, passengerId, snapshot, rules.config.quoteTtlSeconds]);
    log('info', 'Dynamic fare quoted', { correlationId, quoteId: snapshot.quoteId, fareAmount: snapshot.fareAmount });
    return stored.snapshot;
  }
  // Bảng giá cho GET /trips/fare-rates: giá gốc từ fare_rates, tên và số chỗ từ fare.VEHICLES.
  async function rates() {
    const { rates: rows } = await getPolicy();
    return VEHICLES.flatMap(vehicle => {
      const rate = rows.find(r => r.vehicle_type === vehicle.vehicleType);
      return rate ? [{ ...vehicle, baseFare: rate.base_fare, perKm: rate.per_km, perMinute: rate.per_minute, minimumFare: rate.minimum_fare }] : [];
    });
  }
  async function lockQuote(client, quoteId, passengerId, body = {}) {
    if (!uuid(quoteId)) fail(400, 'Invalid quoteId');
    const { rows: [row] } = await client.query('SELECT * FROM fare_quotes WHERE quote_id=$1 AND passenger_id=$2 FOR UPDATE', [quoteId, passengerId]);
    if (!row) fail(404, 'Quote not found for this passenger');
    const snapshot = row.snapshot;
    for (const key of ['pickup', 'destination']) {
      if (body[key] !== undefined && (!location(body[key]) || body[key].lat !== snapshot[key].lat || body[key].lng !== snapshot[key].lng)) fail(409, 'Route changed; request a new quote');
    }
    if (body.vehicleType !== undefined && body.vehicleType !== snapshot.vehicleType) fail(409, 'Vehicle type changed; request a new quote');
    // A committed booking can be retried after expiration without creating another trip.
    if (!row.trip_id) {
      // SELECT projections are evaluated before PostgreSQL waits for a row lock.
      // Read the database clock in a separate statement after the lock is held.
      const { rows: [validity] } = await client.query('SELECT expires_at > clock_timestamp() AS valid FROM fare_quotes WHERE quote_id=$1', [quoteId]);
      if (!validity.valid) fail(409, 'Quote expired; request a new quote');
    }
    return { snapshot, tripId: row.trip_id };
  }
  async function refreshCell(entry, rules) {
    const cell = cellFor(entry.center, rules.config.cellSizeKm);
    const key = `pricing:surge:${rules.revision}:${entry.vehicleType}:${cell.id}`;
    const token = crypto.randomUUID(), lockKey = `${key}:lock`;
    if (!await cache.set(lockKey, token, { NX: true, EX: 20 })) return;
    try {
      // Other workers skip a freshly computed snapshot after acquiring the lock.
      const stored = await cache.get(key);
      if (stored && now().getTime() - Date.parse(JSON.parse(stored).updatedAt) < rules.config.surgeRefreshSeconds * 1000) return;
      const [demandResult, drivers] = await Promise.all([
        db.query(DEMAND_SQL, [entry.vehicleType, cell.center.lat, cell.center.lng, rules.config.surgeRadiusKm]),
        driver.request('DRIVER-SERVICE', `/internal/drivers/available?lat=${cell.center.lat}&lng=${cell.center.lng}&radius=${rules.config.surgeRadiusKm}`, token, null, 'GET'),
      ]);
      if (!Array.isArray(drivers)) throw new Error('Invalid driver availability');
      const demand = demandResult.rows[0].demand;
      const supply = drivers.filter(d => d.vehicleType === entry.vehicleType).length;
      const snapshot = { multiplier: surgeFor(demand, supply, rules.config), demand, availableDrivers: supply,
        radiusKm: rules.config.surgeRadiusKm, updatedAt: now().toISOString() };
      await cache.set(key, JSON.stringify(snapshot), { EX: rules.config.surgeCacheSeconds });
    } finally {
      await cache.eval(RELEASE_LOCK, { keys: [lockKey], arguments: [token] });
    }
  }
  async function refreshSurge() {
    if (ticking) return;
    ticking = true;
    try {
      const rules = await getPolicy();
      await db.query("DELETE FROM fare_quotes WHERE trip_id IS NULL AND expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'");
      if (!cache.isReady) return;
      const cutoff = now().getTime() - 15 * 60000;
      await cache.zRemRangeByScore(ACTIVE_CELLS, '-inf', cutoff);
      const entries = await cache.zRangeByScore(ACTIVE_CELLS, cutoff, '+inf');
      // Bound concurrency while each cell is protected across service instances.
      for (let i = 0; i < entries.length; i += 4) {
        const results = await Promise.allSettled(entries.slice(i, i + 4).map(value => refreshCell(JSON.parse(value), rules)));
        for (const result of results) if (result.status === 'rejected') log('warn', `Surge cell refresh failed: ${result.reason.message}`);
      }
    } catch (error) { log('warn', `Surge refresh failed: ${error.message}`); }
    finally { ticking = false; }
  }
  async function initialize() {
    await db.query(fs.readFileSync(path.join(__dirname, 'pricing-schema.sql'), 'utf8'));
    await getPolicy();
  }
  function start() {
    if (!stopped) return;
    stopped = false;
    cache.connect().catch(() => log('warn', 'Pricing Redis connection failed'));
    const tick = async () => {
      if (stopped) return;
      await refreshSurge();
      if (!stopped) { timer = setTimeout(tick, (policy?.config.surgeRefreshSeconds || 45) * 1000); timer.unref(); }
    };
    void tick();
  }
  async function close() {
    stopped = true;
    clearTimeout(timer);
    if (cache.isOpen) cache.destroy();
  }
  return { quote, rates, lockQuote, initialize, getPolicy, refreshSurge, start, close };
}

let instance;
function current() {
  instance ||= createPricing({ db: require('./db'), cache: require('./pricing-cache'), driver: require('./service-client'), log: require('./logger') });
  return instance;
}
module.exports = { createPricing, POLICY_SQL, DEMAND_SQL,
  quote: (...args) => current().quote(...args), rates: () => current().rates(), lockQuote: (...args) => current().lockQuote(...args),
  initialize: () => current().initialize(), start: () => current().start(), close: () => instance?.close(),
};
