'use strict';
const { fail } = require('./auth');

const PRICING_VERSION = 'haversine-v1';
// Giá mặc định, cũng là dữ liệu nạp sẵn cho bảng fare_rates. Xe máy giữ đúng công thức
// trước khi có loại xe (12.000 đ + 10.000 đ/km) để giá chuyến cũ không đổi.
const DEFAULT_RATES = Object.freeze([
  Object.freeze({ vehicleType: 'MOTORCYCLE', displayName: 'Xe máy', seats: 1, baseFare: 12000, perKm: 10000 }),
  Object.freeze({ vehicleType: 'CAR_4_SEAT', displayName: 'Ô tô 4 chỗ', seats: 4, baseFare: 20000, perKm: 15000 }),
  Object.freeze({ vehicleType: 'CAR_7_SEAT', displayName: 'Ô tô 7 chỗ', seats: 7, baseFare: 25000, perKm: 18000 }),
]);
const VEHICLE_TYPES = DEFAULT_RATES.map(rate => rate.vehicleType);
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

// Khoảng cách đường thẳng (Haversine), làm tròn 0,01 km trước khi tính giá để quãng đường
// đã lưu quyết định hoàn toàn giá cước; đây không phải dịch vụ tìm đường theo phố.
function distanceKm(pickup, destination) {
  const radians = degrees => degrees * Math.PI / 180;
  const a = Math.sin(radians(destination.lat - pickup.lat) / 2) ** 2
    + Math.cos(radians(pickup.lat)) * Math.cos(radians(destination.lat))
    * Math.sin(radians(destination.lng - pickup.lng) / 2) ** 2;
  const distance = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
  return Math.round(distance * 100) / 100;
}

// Giá mở cửa + km × giá mỗi km, làm tròn lên 1.000 đ.
const priceFor = (distance, rate) => Math.ceil((rate.baseFare + Math.round(distance * rate.perKm)) / 1000) * 1000;

function estimate(pickup, destination, rates = DEFAULT_RATES, vehicleType = rates[0]?.vehicleType) {
  if (!location(pickup) || !location(destination)) fail(400, 'Invalid pickup or destination');
  const rate = rates.find(r => r.vehicleType === vehicleType);
  if (!rate) fail(400, 'Invalid vehicleType');
  const estimatedDistance = distanceKm(pickup, destination);
  const options = rates.map(r => ({
    vehicleType: r.vehicleType, displayName: r.displayName, seats: r.seats,
    estimatedDistance, fareAmount: priceFor(estimatedDistance, r), currency: 'VND', pricingVersion: PRICING_VERSION,
  }));
  return { estimatedDistance, fareAmount: priceFor(estimatedDistance, rate), currency: 'VND', pricingVersion: PRICING_VERSION, vehicleType: rate.vehicleType, options };
}

module.exports = { estimate, point, DEFAULT_RATES, VEHICLE_TYPES };
