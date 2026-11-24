'use strict';
// Voucher giảm giá cho hành khách. Giảm giá tính trên giá cuối mà dynamic pricing báo
// (fare_quotes), làm tròn xuống 1.000 đ, giá sau giảm tối thiểu 1.000 đ. Mỗi khách dùng mỗi mã
// một lần (index UNIQUE một phần); chuyến bị hủy hoặc thất bại thì trả mã (RETURNED).
const { fail } = require('./auth');

const MIN_FINAL_FARE = 1000;

// Chạy idempotent lúc khởi động, áp dụng được cho volume trip_db cũ.
const SCHEMA = `
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "paymentMethod" VARCHAR(10) NOT NULL DEFAULT 'BANK';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "originalFare" NUMERIC(12, 2);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "discountAmount" NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "voucherCode" VARCHAR(30);
CREATE TABLE IF NOT EXISTS vouchers (
    code          VARCHAR(30)     PRIMARY KEY,
    description   TEXT            NOT NULL,
    discount_type VARCHAR(10)     NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED')),
    value         NUMERIC(12, 2)  NOT NULL CHECK (value > 0),
    max_discount  NUMERIC(12, 2)  CHECK (max_discount > 0),
    min_fare      NUMERIC(12, 2)  NOT NULL DEFAULT 0 CHECK (min_fare >= 0),
    vehicle_type  VARCHAR(20)     CHECK (vehicle_type IN ('MOTORCYCLE', 'CAR_4_SEAT', 'CAR_7_SEAT')),
    valid_from    TIMESTAMPTZ     NOT NULL,
    valid_to      TIMESTAMPTZ     NOT NULL,
    active        BOOLEAN         NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS voucher_redemptions (
    trip_id       UUID            PRIMARY KEY,
    code          VARCHAR(30)     NOT NULL REFERENCES vouchers (code),
    passenger_id  UUID            NOT NULL,
    status        VARCHAR(10)     NOT NULL CHECK (status IN ('USED', 'RETURNED')),
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS voucher_redemptions_one_use_idx
    ON voucher_redemptions (code, passenger_id) WHERE status = 'USED';
INSERT INTO vouchers (code, description, discount_type, value, max_discount, min_fare, vehicle_type, valid_from, valid_to) VALUES
    ('GIAM20', 'Giảm 20%, tối đa 30.000 đ', 'PERCENT', 20, 30000, 0, NULL, '2026-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00'),
    ('GIAM10K', 'Giảm 10.000 đ cho chuyến từ 30.000 đ', 'FIXED', 10000, NULL, 30000, NULL, '2026-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00'),
    ('XEMAY50', 'Giảm 50% cho xe máy, tối đa 20.000 đ', 'PERCENT', 50, 20000, 0, 'MOTORCYCLE', '2026-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00')
ON CONFLICT (code) DO NOTHING;
`;

async function initialize(db) {
  await db.query(SCHEMA);
}

const normalize = code => (typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : null);

function toVoucher(row) {
  const money = value => (value === null || value === undefined ? null : Number(value));
  return {
    code: row.code, description: row.description, discountType: row.discount_type, value: Number(row.value),
    maxDiscount: money(row.max_discount), minFare: Number(row.min_fare), vehicleType: row.vehicle_type,
    validFrom: new Date(row.valid_from).toISOString(), validTo: new Date(row.valid_to).toISOString(), active: row.active,
  };
}

// Số tiền giảm của một voucher cho một giá và loại xe. Không áp dụng được thì trả lý do.
function discountFor(voucher, fare, vehicleType, now = new Date()) {
  const no = reason => ({ applicable: false, discountAmount: 0, reason });
  if (!voucher) return no('UNAVAILABLE');
  if (!voucher.active || now < new Date(voucher.validFrom) || now > new Date(voucher.validTo)) return no('EXPIRED');
  if (voucher.vehicleType && voucher.vehicleType !== vehicleType) return no('VEHICLE_NOT_ELIGIBLE');
  if (fare < voucher.minFare) return no('FARE_TOO_LOW');
  let raw = voucher.discountType === 'PERCENT' ? fare * voucher.value / 100 : voucher.value;
  if (voucher.maxDiscount !== null && voucher.maxDiscount !== undefined) raw = Math.min(raw, voucher.maxDiscount);
  raw = Math.min(raw, fare - MIN_FINAL_FARE);
  const discountAmount = Math.floor(raw / 1000) * 1000;
  return discountAmount > 0 ? { applicable: true, discountAmount, reason: null } : no('FARE_TOO_LOW');
}

// Các mã khách còn dùng được lúc này: đang bật, còn hạn, khách chưa dùng.
async function available(db, passengerId, now = new Date()) {
  const { rows } = await db.query(`SELECT v.* FROM vouchers v
    WHERE v.active AND v.valid_from <= $2 AND v.valid_to >= $2
      AND NOT EXISTS (SELECT 1 FROM voucher_redemptions r WHERE r.code = v.code AND r.passenger_id = $1 AND r.status = 'USED')
    ORDER BY v.code`, [passengerId, now.toISOString()]);
  return rows.map(toVoucher);
}

async function redeem(client, code, passengerId, tripId) {
  try {
    await client.query("INSERT INTO voucher_redemptions (trip_id, code, passenger_id, status) VALUES ($1, $2, $3, 'USED')", [tripId, code, passengerId]);
  } catch (error) {
    if (error.code === '23505') fail(409, 'Voucher đã được dùng');
    throw error;
  }
}

async function release(client, tripId) {
  await client.query("UPDATE voucher_redemptions SET status = 'RETURNED', updated_at = CURRENT_TIMESTAMP WHERE trip_id = $1 AND status = 'USED'", [tripId]);
}

module.exports = { SCHEMA, initialize, normalize, discountFor, available, redeem, release };
