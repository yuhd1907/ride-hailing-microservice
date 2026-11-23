'use strict';
const { uuid } = require('./validation');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

// Gateway strips client identity headers and sets these from the verified JWT.
// Service ports must stay inside the trusted deployment network.
function identity(req) {
  const userId = req.get('x-user-id');
  if (!uuid(userId)) fail(401, 'Missing authenticated identity');
  const roles = (req.get('x-user-roles') || '').split(',').map(value => value.trim()).filter(Boolean);
  return { userId: userId.toLowerCase(), roles };
}

function actor(req, role) {
  const { userId, roles } = identity(req);
  if (!roles.includes(role)) fail(403, `Required role: ${role}`);
  return userId;
}

function assignedDriver(req, trip) {
  const userId = actor(req, 'ROLE_DRIVER');
  if (trip.driverId !== userId) fail(403, 'Only the assigned driver can perform this action');
}

// Hành khách đặt chuyến hoặc tài xế được giao mới đọc được chuyến.
function canRead(viewer, trip) {
  const passenger = viewer.roles.includes('ROLE_PASSENGER') && trip.passengerId === viewer.userId;
  const assigned = viewer.roles.includes('ROLE_DRIVER') && trip.driverId === viewer.userId;
  if (!passenger && !assigned) fail(403, 'Trip is not accessible to this user');
}

module.exports = { identity, actor, assignedDriver, canRead, fail };
