'use strict';
const { distanceKm } = require('./fare');

function validatePolicy(policy) {
  const c = policy?.config;
  const range = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  if (!c || typeof c.timezone !== 'string' || !c.timezone || !range(c.quoteTtlSeconds, 30, 600) || !Number.isInteger(c.quoteTtlSeconds)
    || !range(c.roundingVnd, 1, 10000) || !Number.isInteger(c.roundingVnd)
    || !range(c.fallbackSpeedKph, 1, 150) || !range(c.cellSizeKm, 0.5, 5)
    || !range(c.surgeRadiusKm, c.cellSizeKm, 50) || !range(c.surgeRefreshSeconds, 30, 60)
    || !Number.isInteger(c.surgeRefreshSeconds) || !Number.isInteger(c.surgeCacheSeconds)
    || !range(c.surgeCacheSeconds, c.surgeRefreshSeconds * 2, 300)
    || !range(c.maxSurgeMultiplier, 1, 2) || !range(c.weekendMultiplier, 1, 3)
    || !range(c.rainMultiplier, 1, 3)) throw new Error('Invalid pricing configuration');
  new Intl.DateTimeFormat('en', { timeZone: c.timezone }).format();
  if (!Array.isArray(c.surgeTiers) || !c.surgeTiers.length || !c.surgeTiers.some(t => t.ratio === 0 && t.multiplier === 1)
    || c.surgeTiers.some(t => !range(t.ratio, 0, 1000) || !range(t.multiplier, 1, 2))) throw new Error('Invalid surge tiers');
  if (!Array.isArray(c.timeWindows) || c.timeWindows.some(w => typeof w.code !== 'string' || typeof w.label !== 'string'
    || !range(w.startHour, 0, 23) || !range(w.endHour, 0, 23) || !Number.isInteger(w.startHour)
    || !Number.isInteger(w.endHour) || w.startHour === w.endHour || !range(w.multiplier, 1, 3))) throw new Error('Invalid pricing time windows');
  if (!Array.isArray(policy.rates) || !policy.rates.length || policy.rates.some(r =>
    !['MOTORCYCLE', 'CAR_4_SEAT', 'CAR_7_SEAT'].includes(r.vehicle_type) || !range(r.base_fare, 1, 10000000)
    || !range(r.minimum_fare, 1, 10000000) || !range(r.per_km, 0, 1000000) || !range(r.per_minute, 0, 1000000))) throw new Error('Invalid fare rates');
  return policy;
}

function cellFor(point, sizeKm) {
  const latStep = sizeKm / 111.32;
  const latIndex = Math.floor((point.lat + 90) / latStep);
  const lat = Math.min(90 - latStep / 2, -90 + (latIndex + 0.5) * latStep);
  const lngStep = Math.min(360, latStep / Math.max(0.000001, Math.cos(lat * Math.PI / 180)));
  const lngIndex = Math.floor((point.lng + 180) / lngStep);
  const lng = Math.min(180 - lngStep / 2, -180 + (lngIndex + 0.5) * lngStep);
  return { id: `${sizeKm}:${latIndex}:${lngIndex}`, center: { lat, lng } };
}

function surgeFor(demand, supply, config) {
  if (!demand) return 1;
  if (!supply) return config.maxSurgeMultiplier;
  return Math.min(config.maxSurgeMultiplier, Math.max(1, ...config.surgeTiers
    .filter(t => demand / supply >= t.ratio).map(t => t.multiplier)));
}

function calculate(policy, rate, pickup, route, surge, weather, now) {
  const c = policy.config;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: c.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const window = c.timeWindows.filter(w => w.startHour < w.endHour
    ? hour >= w.startHour && hour < w.endHour : hour >= w.startHour || hour < w.endHour)
    .sort((a, b) => b.multiplier - a.multiplier)[0];
  const holiday = policy.holidays.find(h => h.holiday_date === date);
  const weekend = ['Sat', 'Sun'].includes(parts.weekday);
  const calendar = holiday ? Number(holiday.multiplier) : weekend ? c.weekendMultiplier : 1;
  const multipliers = { time: window?.multiplier || 1, surge: Math.max(1, Math.min(c.maxSurgeMultiplier, surge.multiplier)), calendar, weather: weather.raining ? c.rainMultiplier : 1 };
  const estimatedDistance = Math.round(route.distanceKm * 100) / 100;
  const estimatedDuration = Math.round(route.durationMinutes * 100) / 100;
  const distanceFare = Math.round(estimatedDistance * rate.per_km);
  const durationFare = Math.round(estimatedDuration * rate.per_minute);
  const subtotal = rate.base_fare + distanceFare + durationFare;
  const multiplier = Object.values(multipliers).reduce((a, b) => a * b, 1);
  // One zone fee: the highest matching surcharge avoids double charging overlaps.
  const zone = policy.zones.filter(z => distanceKm(pickup, { lat: z.latitude, lng: z.longitude }) <= z.radius_km)
    .sort((a, b) => b.surcharge - a.surcharge || a.code.localeCompare(b.code))[0];
  const zoneSurcharge = zone?.surcharge || 0;
  const beforeRounding = Math.max(rate.minimum_fare, subtotal * multiplier) + zoneSurcharge;
  const fareAmount = Math.ceil(Math.round(beforeRounding * 100) / 100 / c.roundingVnd) * c.roundingVnd;
  if (!Number.isFinite(fareAmount) || fareAmount <= 0 || fareAmount > 9999999999.99) throw new Error('Fare outside payment limits');
  const reasons = [];
  if (multipliers.time > 1) reasons.push({ code: window.code, label: window.label, multiplier: multipliers.time });
  if (multipliers.surge > 1) reasons.push({ code: 'HIGH_DEMAND', label: 'Nhiều người đặt', multiplier: multipliers.surge });
  if (calendar > 1) reasons.push({ code: holiday ? 'HOLIDAY' : 'WEEKEND', label: holiday?.name || 'Cuối tuần', multiplier: calendar });
  if (multipliers.weather > 1) reasons.push({ code: 'RAIN', label: 'Trời mưa', multiplier: multipliers.weather });
  if (zoneSurcharge) reasons.push({ code: zone.code, label: zone.name, amount: zoneSurcharge });
  return { estimatedDistance, estimatedDuration, fareAmount, currency: 'VND', pricingVersion: 'dynamic-v1',
    breakdown: { baseFare: rate.base_fare, perKm: rate.per_km, perMinute: rate.per_minute, distanceFare, durationFare,
      subtotal, minimumFare: rate.minimum_fare, multipliers, combinedMultiplier: multiplier, zoneSurcharge,
      roundingAdjustment: Number((fareAmount - beforeRounding).toFixed(2)), reasons, timezone: c.timezone, localDate: date },
  };
}
module.exports = { validatePolicy, cellFor, surgeFor, calculate };
