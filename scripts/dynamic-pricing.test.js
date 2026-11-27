'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('../trip-service/node_modules/@electric-sql/pglite');
const express = require('../trip-service/node_modules/express');
const { createPricing, DEMAND_SQL } = require('../trip-service/src/pricing');
const { calculate, surgeFor, cellFor, validatePolicy } = require('../trip-service/src/pricing-policy');
const { createProviders } = require('../trip-service/src/pricing-providers');
const uuid = () => crypto.randomUUID();
const quiet = () => {};

function load(service, file, mocks) {
  const filename = path.resolve(__dirname, '..', service, 'src', file);
  const mod = { exports: {} }, localRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, require: name => mocks[name] || localRequire(name), console, process }, { filename });
  return mod.exports;
}
function memoryCache() {
  const values = new Map(), active = new Map();
  return { isReady: true, values, active,
    get: async key => values.get(key) || null,
    set: async (key, value, options = {}) => { if (options.NX && values.has(key)) return null; values.set(key, value); return 'OK'; },
    zAdd: async (key, entry) => active.set(entry.value, entry.score),
    zRangeByScore: async (key, min) => [...active].filter(([, score]) => score >= min).map(([value]) => value),
    zRemRangeByScore: async (key, min, max) => { for (const [value, score] of active) if (score <= max) active.delete(value); },
    eval: async (script, { keys, arguments: args }) => { if (values.get(keys[0]) === args[0]) values.delete(keys[0]); },
  };
}

test('dynamic pricing: real PostgreSQL schema, quotes, worker and HTTP payment flow', async t => {
  // PGlite runs PostgreSQL in WASM; SQL/constraints/rollback are real, one connection.
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(fs.readFileSync(path.resolve(__dirname, '../trip-service/trip_db.sql'), 'utf8'));
  const queries = [];
  const db = { query: async (sql, args) => {
    queries.push(sql);
    if (args === undefined && sql.includes(';')) { const results = await pg.exec(sql); return results.at(-1); }
    return pg.query(sql, args);
  } };
  db.connect = async () => ({ query: db.query, release: quiet });
  let clock = new Date('2026-11-23T05:00:00Z'); // Monday noon in Viet Nam.
  const cache = memoryCache(), driverCalls = [];
  const available = [{ id: uuid(), vehicleType: 'MOTORCYCLE' }, { id: uuid(), vehicleType: 'CAR_4_SEAT' }];
  const driver = { request: async (...args) => { driverCalls.push(args); return available; } };
  const providers = {
    route: async () => ({ distanceKm: 5, durationMinutes: 10, source: 'google_routes_traffic' }),
    weather: async () => ({ raining: false, status: 'available', condition: 'CLEAR' }),
  };
  const pricing = createPricing({ db, cache, driver, providers, now: () => clock });
  await pricing.initialize();
  await pricing.initialize(); // Existing DB and repeated startup.
  const policy = await pricing.getPolicy(), rate = policy.rates.find(r => r.vehicle_type === 'MOTORCYCLE');
  const pickup = { lat: 10.77, lng: 106.7 }, destination = { lat: 10.8, lng: 106.72 };
  const body = { pickup, destination, vehicleType: 'MOTORCYCLE' }, owner = uuid();

  await t.test('time boundaries use Viet Nam timezone; minimum, rounding, calendar and zones', () => {
    const route = { distanceKm: 5, durationMinutes: 10 }, neutral = { multiplier: 1 }, clear = { raining: false };
    const price = at => calculate(policy, rate, pickup, route, neutral, clear, new Date(at));
    assert.equal(price('2026-11-23T05:00:00Z').fareAmount, 32000);
    for (const [at, multiplier] of [
      ['2026-11-22T23:59:59Z', 1], ['2026-11-23T00:00:00Z', 1.2], ['2026-11-23T02:00:00Z', 1],
      ['2026-11-23T10:00:00Z', 1.2], ['2026-11-23T12:00:00Z', 1],
      ['2026-11-23T15:00:00Z', 1.15], ['2026-11-23T21:59:59Z', 1.15], ['2026-11-23T22:00:00Z', 1],
    ]) assert.equal(price(at).breakdown.multipliers.time, multiplier, at);
    assert.equal(price('2026-11-28T05:00:00Z').breakdown.multipliers.calendar, 1.1);
    const holiday = { ...policy, holidays: [{ holiday_date: '2026-11-28', name: 'Test holiday', multiplier: 1.5 }] };
    const zones = [{ code: 'A', name: 'A', latitude: pickup.lat, longitude: pickup.lng, radius_km: 1, surcharge: 10000 },
      { code: 'B', name: 'B', latitude: pickup.lat, longitude: pickup.lng, radius_km: 1, surcharge: 15000 }];
    const special = calculate({ ...holiday, zones }, rate, pickup, route, { multiplier: 999 }, { raining: true }, new Date('2026-11-28T05:00:00Z'));
    assert.equal(special.breakdown.multipliers.surge, 2);
    assert.equal(special.breakdown.multipliers.calendar, 1.5);
    assert.equal(special.breakdown.zoneSurcharge, 15000);
    assert.equal(special.breakdown.reasons.find(r => r.code === 'HOLIDAY').label, 'Test holiday');
    assert.equal(calculate(policy, { ...rate, minimum_fare: 25000 }, pickup, { distanceKm: 0, durationMinutes: 0 }, neutral, clear, clock).fareAmount, 25000);
    assert.throws(() => validatePolicy({ ...policy, config: { ...policy.config, maxSurgeMultiplier: 10 } }), /configuration/);
  });

  await t.test('surge tiers cover empty supply/demand, threshold and hard ceiling', () => {
    for (const [demand, supply, expected] of [[0, 0, 1], [0, 5, 1], [1, 0, 2], [1, 1, 1], [3, 2, 1.2], [4, 2, 1.5], [6, 2, 2], [9999, 1, 2]]) {
      assert.equal(surgeFor(demand, supply, policy.config), expected);
    }
    assert.equal(surgeFor(10, 0, { ...policy.config, maxSurgeMultiplier: 1.5 }), 1.5);
    assert.equal(cellFor(pickup, 1).id, cellFor({ lat: pickup.lat + 0.000001, lng: pickup.lng }, 1).id);
  });

  await t.test('quotes ignore client money, bind owner/route/type and expire at the exact boundary', async () => {
    const quote = await pricing.quote(owner, { ...body, fareAmount: 1, surgeMultiplier: 100, estimatedDistance: 999 }, uuid());
    assert.equal(quote.fareAmount, 32000);
    assert.equal(quote.estimatedDuration, 10);
    assert.equal(Date.parse(quote.expiresAt) - Date.parse(quote.createdAt), 120000);
    assert.equal(quote.surge.status, 'warming_up');
    assert.ok(quote.notices.includes('SURGE_WARMING_UP'));
    assert.equal((await pricing.lockQuote(db, quote.quoteId, owner, body)).snapshot.fareAmount, 32000);
    await assert.rejects(pricing.lockQuote(db, quote.quoteId, uuid()), { status: 404 });
    await assert.rejects(pricing.lockQuote(db, quote.quoteId, owner, { ...body, vehicleType: 'CAR_4_SEAT' }), { status: 409 });
    await assert.rejects(pricing.lockQuote(db, quote.quoteId, owner, { ...body, destination: pickup }), { status: 409 });
    await assert.rejects(pricing.lockQuote(db, 'bad-id', owner), { status: 400 });
    await assert.rejects(pricing.quote(owner, { ...body, vehicleType: 'BICYCLE' }), { status: 400 });
    await assert.rejects(pricing.quote(owner, { ...body, pickup: { lat: '10', lng: 106 } }), { status: 400 });
    await pg.query('UPDATE fare_quotes SET expires_at=clock_timestamp() WHERE quote_id=$1', [quote.quoteId]);
    await assert.rejects(pricing.lockQuote(db, quote.quoteId, owner), { status: 409 });
  });

  await t.test('background worker counts nearby waiting trips by vehicle; estimates read cache only', async () => {
    const insert = (point, type, status) => pg.query('INSERT INTO trips ("passengerId",pickup,destination,"estimatedDistance",fare,"vehicleType",status) VALUES ($1,$2,$3,5,65000,$4,$5)', [owner, point, destination, type, status]);
    await insert(pickup, 'MOTORCYCLE', 'REQUESTED');
    await insert(pickup, 'MOTORCYCLE', 'MATCHING');
    await insert(pickup, 'MOTORCYCLE', 'AWAITING_DRIVER');
    await insert({ lat: 11.9, lng: 108 }, 'MOTORCYCLE', 'REQUESTED');
    await insert(pickup, 'CAR_4_SEAT', 'REQUESTED');
    const cell = cellFor(pickup, 1);
    assert.equal((await db.query(DEMAND_SQL, ['MOTORCYCLE', cell.center.lat, cell.center.lng, 3])).rows[0].demand, 2);
    await pricing.refreshSurge();
    assert.equal(driverCalls.length, 1);
    const quote = await pricing.quote(owner, body);
    assert.equal(quote.surge.demand, 2);
    assert.equal(quote.surge.availableDrivers, 1);
    assert.equal(quote.breakdown.multipliers.surge, 1.5);
    assert.equal(quote.fareAmount, 48000);
    const countQueries = queries.filter(q => q === DEMAND_SQL).length;
    await pricing.quote(owner, body);
    await pricing.refreshSurge(); // Fresh cache is not re-counted by another worker.
    assert.equal(queries.filter(q => q === DEMAND_SQL).length, countQueries);
    assert.equal(driverCalls.length, 1);
    cache.isReady = false;
    const degraded = await pricing.quote(owner, body);
    assert.equal(degraded.breakdown.multipliers.surge, 1);
    assert.ok(degraded.notices.includes('SURGE_UNAVAILABLE'));
    cache.isReady = true;
    // Expired cached surge cannot continue charging even if Redis retains the key.
    clock = new Date(clock.getTime() + 121000);
    assert.equal((await pricing.quote(owner, body)).surge.status, 'warming_up');
  });

  await t.test('startup lowers rows still on the old default fare table, keeps manually tuned rows', async () => {
    const row = type => pg.query('SELECT base_fare, per_km, per_minute, minimum_fare FROM fare_rates WHERE vehicle_type=$1', [type]).then(r => r.rows[0]);
    await pg.query("UPDATE fare_rates SET base_fare=12000, per_km=10000, per_minute=300 WHERE vehicle_type='MOTORCYCLE'");
    await pg.query("UPDATE fare_rates SET per_km=9000 WHERE vehicle_type='CAR_4_SEAT'");
    await pricing.initialize();
    assert.deepEqual(await row('MOTORCYCLE'), { base_fare: 10000, per_km: 4000, per_minute: 200, minimum_fare: 12000 });
    assert.equal((await row('CAR_4_SEAT')).per_km, 9000);
    await pg.query("UPDATE fare_rates SET per_km=8500 WHERE vehicle_type='CAR_4_SEAT'");
  });

  await t.test('DB rule updates change new quotes while old snapshots retain their fare', async () => {
    const old = await pricing.quote(owner, body);
    await pg.query("UPDATE fare_rates SET per_km=12000 WHERE vehicle_type='MOTORCYCLE'");
    clock = new Date(clock.getTime() + 31000);
    const fresh = await pricing.quote(owner, body);
    assert.equal(fresh.fareAmount, 72000);
    assert.notEqual(fresh.pricingRevision, old.pricingRevision);
    assert.equal((await pricing.lockQuote(db, old.quoteId, owner)).snapshot.fareAmount, old.fareAmount);
    await pricing.initialize();
    assert.equal((await pg.query("SELECT per_km FROM fare_rates WHERE vehicle_type='MOTORCYCLE'")).rows[0].per_km, 12000);
  });

  await t.test('HTTP duplicate booking creates one trip/outbox; completion and payment retain the quote', async () => {
    const baseEvents = load('trip-service', 'events.js', { './db': db, './rabbitmq': {}, './logger': quiet });
    const events = { ...baseEvents, transaction: work => pg.transaction(tx => work(tx)) };
    const saga = load('trip-service', 'saga.js', { './events': events, './service-client': driver, './logger': quiet });
    const routes = load('trip-service', 'routes.js', { './db': db, './events': events, './saga': saga, './pricing': pricing, './service-client': driver });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.correlationId = uuid(); next(); });
    routes(Object.fromEntries(['get', 'post'].map(method => [method, (route, handler) => app[method](route, (req, res, next) => Promise.resolve(handler(req, res)).catch(next))])));
    app.use((error, req, res, next) => res.status(error.status || 503).json({ error: error.message }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const call = async (url, payload, user = owner, role = 'ROLE_PASSENGER') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': user, 'X-User-Roles': role }, body: JSON.stringify(payload || {}) });
      return { status: response.status, data: await response.json() };
    };
    try {
      const { data: quote } = await call('/trips/estimate', body);
      const [a, b] = await Promise.all([call('/trips', { quoteId: quote.quoteId, fareAmount: 1 }), call('/trips', { quoteId: quote.quoteId })]);
      assert.equal(a.status, 201, JSON.stringify(a.data));
      assert.equal(b.status, 201);
      assert.equal(a.data.tripId, b.data.tripId);
      const trip = a.data, driverId = uuid();
      assert.equal(Number(trip.fare), quote.fareAmount);
      assert.equal(trip.quoteId, quote.quoteId);
      assert.equal(trip.pricingSnapshot.fareAmount, quote.fareAmount);
      const messages = await pg.query("SELECT envelope FROM event_outbox WHERE envelope->'payload'->>'tripId'=$1", [trip.tripId]);
      assert.equal(messages.rows.length, 1);
      assert.equal(messages.rows[0].envelope.payload.vehicleType, 'MOTORCYCLE');
      assert.equal((await call('/trips', { quoteId: quote.quoteId }, uuid())).status, 404);
      assert.equal((await call('/trips', { quoteId: quote.quoteId, vehicleType: 'CAR_4_SEAT' })).status, 409);
      assert.equal((await call('/trips', { quoteId: null })).status, 400);
      clock = new Date(clock.getTime() + 130000);
      await pg.query("UPDATE fare_quotes SET expires_at=clock_timestamp() - INTERVAL '1 second' WHERE quote_id=$1", [quote.quoteId]);
      assert.equal((await call('/trips', { quoteId: quote.quoteId })).data.tripId, trip.tripId);
      const expired = await pricing.quote(owner, body);
      await pg.query('UPDATE fare_quotes SET expires_at=clock_timestamp() WHERE quote_id=$1', [expired.quoteId]);
      assert.equal((await call('/trips', { quoteId: expired.quoteId })).status, 409);
      const retryQuote = await call('/trips/estimate', body);
      const enqueue = events.enqueue;
      events.enqueue = async () => { throw new Error('Simulated outbox failure'); };
      assert.equal((await call('/trips', { quoteId: retryQuote.data.quoteId })).status, 503);
      events.enqueue = enqueue;
      assert.equal((await pg.query('SELECT trip_id FROM fare_quotes WHERE quote_id=$1', [retryQuote.data.quoteId])).rows[0].trip_id, null);
      assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM trips WHERE "quoteId"=$1', [retryQuote.data.quoteId])).rows[0].n, 0);
      assert.equal((await call('/trips', { quoteId: retryQuote.data.quoteId })).status, 201);
      await pg.query('UPDATE trips SET "driverId"=$2,status=$3 WHERE "tripId"=$1', [trip.tripId, driverId, 'IN_PROGRESS']);
      assert.equal((await call(`/trips/${trip.tripId}/complete`, { fareAmount: 999999 }, driverId, 'ROLE_DRIVER')).status, 200);
      assert.equal((await call(`/trips/${trip.tripId}/complete`, { fareAmount: 1 }, driverId, 'ROLE_DRIVER')).status, 200);
      const completed = await pg.query("SELECT envelope FROM event_outbox WHERE envelope->>'eventType'='trip.completed' AND envelope->'payload'->>'tripId'=$1", [trip.tripId]);
      assert.equal(completed.rows.length, 1);
      assert.equal(completed.rows[0].envelope.payload.fareAmount, quote.fareAmount);
      const payment = { eventId: uuid(), eventType: 'payment.succeeded', correlationId: trip.sagaId,
        payload: { tripId: trip.tripId, riderId: owner, driverId, paymentId: uuid(), amount: quote.fareAmount } };
      await saga.payment(payment);
      await saga.payment(payment);
      assert.equal((await pg.query('SELECT status FROM trips WHERE "tripId"=$1', [trip.tripId])).rows[0].status, 'CONFIRMED');
      const car = await call('/trips/estimate', { ...body, vehicleType: 'CAR_4_SEAT' });
      assert.equal(car.data.fareAmount, 64000);
      assert.equal((await call('/trips', { quoteId: car.data.quoteId })).data.vehicleType, 'CAR_4_SEAT');
      assert.equal((await call('/trips/estimate', { ...body, vehicleType: 'CAR_7_SEAT' })).data.fareAmount, 78000);
      assert.equal((await call('/trips', body)).status, 201); // Legacy direct booking.
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

test('Google providers: traffic distance/time, travel mode, fallback and failure behavior', async () => {
  const pickup = { lat: 10.77, lng: 106.7 }, destination = { lat: 10.8, lng: 106.72 }, calls = [];
  const providers = createProviders({ env: { GOOGLE_ROUTES_API_KEY: 'test', GOOGLE_WEATHER_API_KEY: 'test' }, request: async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, json: async () => String(url).includes('routes.googleapis') ? { routes: [{ distanceMeters: 7200, duration: '1230s' }] } : { weatherCondition: { type: 'RAIN' } } };
  } });
  const route = await providers.route(pickup, destination, 'MOTORCYCLE', {});
  assert.equal(route.distanceKm, 7.2);
  assert.equal(route.durationMinutes, 20.5);
  assert.equal(JSON.parse(calls[0].init.body).travelMode, 'TWO_WHEELER');
  assert.equal(JSON.parse(calls[0].init.body).routingPreference, 'TRAFFIC_AWARE');
  await providers.route(pickup, destination, 'CAR_4_SEAT', {});
  assert.equal(JSON.parse(calls[1].init.body).travelMode, 'DRIVE');
  assert.equal((await providers.weather(pickup)).raining, true);
  const fallback = createProviders({ env: {}, request: async () => { throw new Error('Unexpected call'); } });
  assert.equal((await fallback.route(pickup, destination, 'CAR_4_SEAT', { fallbackSpeedKph: 25 })).source, 'straight_line_estimate');
  assert.equal((await fallback.weather(pickup)).status, 'disabled');
  const failed = createProviders({ env: { GOOGLE_ROUTES_API_KEY: 'test', GOOGLE_WEATHER_API_KEY: 'test' }, request: async () => ({ ok: false }) });
  await assert.rejects(failed.route(pickup, destination, 'CAR_4_SEAT', {}), { status: 503 });
  assert.equal((await failed.weather(pickup)).status, 'unavailable');
  const invalid = createProviders({ env: { GOOGLE_ROUTES_API_KEY: 'test' }, request: async () => ({ ok: true, json: async () => ({ routes: [{ distanceMeters: 1, duration: 'invalid' }] }) }) });
  await assert.rejects(invalid.route(pickup, destination, 'CAR_4_SEAT', {}), { status: 503 });
  const forecast = createProviders({ env: { GOOGLE_WEATHER_API_KEY: 'test' }, request: async () => ({ ok: true, json: async () => ({ weatherCondition: { type: 'CHANCE_OF_SHOWERS' } }) }) });
  assert.equal((await forecast.weather(pickup)).raining, false);
});
