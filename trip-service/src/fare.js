'use strict';
const { fail } = require('./auth');

// Thông tin hiển thị của từng loại xe, theo thứ tự trên web. Giá nằm trong bảng fare_rates
// và được tính ở pricing-policy.js.
const VEHICLES = Object.freeze([
  Object.freeze({ vehicleType: 'MOTORCYCLE', displayName: 'Xe máy', seats: 1 }),
  Object.freeze({ vehicleType: 'CAR_4_SEAT', displayName: 'Ô tô 4 chỗ', seats: 4 }),
  Object.freeze({ vehicleType: 'CAR_7_SEAT', displayName: 'Ô tô 7 chỗ', seats: 7 }),
]);
const MAX_ADDRESS = 200;

function location(point) {
  return point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

// Chỉ giữ tọa độ và địa chỉ hiển thị; bỏ ký tự điều khiển, gộp khoảng trắng, tối đa 200 ký tự.
function point(value) {
  if (!location(value)) fail(400, 'Invalid pickup or destination');
  const result = { lat: value.lat, lng: value.lng };
  if (typeof value.address === 'string') {
    // eslint-disable-next-line no-control-regex
    const address = value.address.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ADDRESS);
    if (address) result.address = address;
  }
  return result;
}

function distanceKm(pickup, destination) {
  if (!location(pickup) || !location(destination)) fail(400, 'Invalid pickup or destination');
  const radians = degrees => degrees * Math.PI / 180;
  const a = Math.sin(radians(destination.lat - pickup.lat) / 2) ** 2
    + Math.cos(radians(pickup.lat)) * Math.cos(radians(destination.lat))
    * Math.sin(radians(destination.lng - pickup.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

module.exports = { distanceKm, location, point, VEHICLES };
