'use strict';
// Bảng giá theo loại xe, lưu trong bảng fare_rates của trip_db. Đổi giá bằng cách cập nhật
// bảng; Trip Service đọc lại sau tối đa 30 giây.
const { DEFAULT_RATES, VEHICLE_TYPES } = require('./fare');

const TTL_MS = 30000;

function toRate(row) {
  const rate = { vehicleType: row.vehicleType, displayName: row.displayName, seats: Number(row.seats), baseFare: Number(row.baseFare), perKm: Number(row.perKm) };
  const valid = VEHICLE_TYPES.includes(rate.vehicleType) && typeof rate.displayName === 'string'
    && Number.isInteger(rate.seats) && rate.seats > 0 && rate.baseFare >= 0 && rate.perKm >= 0;
  return valid ? rate : null;
}

module.exports = function createRates(db, { ttlMs = TTL_MS, now = Date.now } = {}) {
  let cached = null;
  let loadedAt = 0;
  return {
    async list() {
      if (cached && now() - loadedAt < ttlMs) return cached;
      const { rows } = await db.query('SELECT "vehicleType", "displayName", seats, "baseFare", "perKm" FROM fare_rates ORDER BY "sortOrder", "vehicleType"', []);
      const rates = rows.map(toRate).filter(Boolean);
      cached = rates.length ? rates : DEFAULT_RATES;
      loadedAt = now();
      return cached;
    },
  };
};

// Tạo bảng và nạp giá mặc định khi Trip Service khởi động; chạy lại an toàn với volume cũ.
module.exports.initialize = async db => {
  await db.query(`CREATE TABLE IF NOT EXISTS fare_rates (
      "vehicleType" VARCHAR(20) PRIMARY KEY CHECK ("vehicleType" IN ('MOTORCYCLE', 'CAR_4_SEAT', 'CAR_7_SEAT')),
      "displayName" VARCHAR(50) NOT NULL,
      seats INTEGER NOT NULL CHECK (seats > 0),
      "baseFare" NUMERIC(12, 2) NOT NULL CHECK ("baseFare" >= 0),
      "perKm" NUMERIC(12, 2) NOT NULL CHECK ("perKm" >= 0),
      "sortOrder" INTEGER NOT NULL DEFAULT 0
    );
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS "vehicleType" VARCHAR(20) NOT NULL DEFAULT 'MOTORCYCLE';`);
  for (const [index, rate] of DEFAULT_RATES.entries()) {
    await db.query('INSERT INTO fare_rates ("vehicleType", "displayName", seats, "baseFare", "perKm", "sortOrder") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("vehicleType") DO NOTHING',
      [rate.vehicleType, rate.displayName, rate.seats, rate.baseFare, rate.perKm, index]);
  }
};
