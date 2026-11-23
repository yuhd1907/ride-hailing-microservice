'use strict';
const { uuid } = require('./validation');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

// Gateway strips client identity headers and sets these from the verified JWT.
// Service ports must stay inside the trusted deployment network.
function actor(req, role) {
  const userId = req.get('x-user-id');
  if (!uuid(userId)) fail(401, 'Missing authenticated identity');
  const roles = (req.get('x-user-roles') || '').split(',').map(value => value.trim());
  if (!roles.includes(role)) fail(403, `Required role: ${role}`);
  return userId.toLowerCase();
}

function assignedDriver(req, trip) {
  const userId = actor(req, 'ROLE_DRIVER');
  if (trip.driverId !== userId) fail(403, 'Only the assigned driver can perform this action');
}

module.exports = { actor, assignedDriver, fail };
