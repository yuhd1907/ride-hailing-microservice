'use strict';
const { fail } = require('./auth');

function location(point) {
  return point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

function distanceKm(pickup, destination) {
  if (!location(pickup) || !location(destination)) fail(400, 'Invalid pickup or destination');
  const radians = degrees => degrees * Math.PI / 180;
  const a = Math.sin(radians(destination.lat - pickup.lat) / 2) ** 2
    + Math.cos(radians(pickup.lat)) * Math.cos(radians(destination.lat))
    * Math.sin(radians(destination.lng - pickup.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

module.exports = { distanceKm, location };
