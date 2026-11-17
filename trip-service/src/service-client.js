'use strict';
const eureka = require('./eureka');
let next = 0;
async function request(app, path, correlationId, body, method = 'POST') {
  const instances = eureka.getInstancesByAppId(app).filter(i => i.status === 'UP');
  if (!instances.length) throw new Error(`No UP instance for ${app}`);
  const instance = instances[next++ % instances.length];
  const response = await fetch(`http://${instance.ipAddr}:${instance.port.$}${path}`, {
    method, signal: AbortSignal.timeout(5000),
    headers: { 'X-Correlation-ID': correlationId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) { const error = new Error(`${app} ${path}: HTTP ${response.status}`); error.status = response.status; throw error; }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function release(driverId, correlationId, tripId) {
  try { await request('DRIVER-SERVICE', `/internal/drivers/${driverId}/release`, correlationId, tripId ? { tripId } : undefined); }
  catch (error) { if (![400, 404, 409, 422].includes(error.status)) throw error; }
}
module.exports = { request, release };
