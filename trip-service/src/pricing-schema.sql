-- Additive, idempotent migration, applied by Trip before accepting requests.
CREATE TABLE IF NOT EXISTS fare_rates (
    vehicle_type TEXT PRIMARY KEY CHECK (vehicle_type IN ('MOTORCYCLE', 'CAR_4_SEAT', 'CAR_7_SEAT')),
    base_fare INTEGER NOT NULL CHECK (base_fare > 0),
    per_km INTEGER NOT NULL CHECK (per_km >= 0),
    per_minute INTEGER NOT NULL CHECK (per_minute >= 0),
    minimum_fare INTEGER NOT NULL CHECK (minimum_fare > 0)
);
INSERT INTO fare_rates VALUES
    ('MOTORCYCLE', 12000, 10000, 300, 12000),
    ('CAR_4_SEAT', 20000, 14000, 500, 25000),
    ('CAR_7_SEAT', 25000, 17000, 600, 30000)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS pricing_rules (
    id TEXT PRIMARY KEY CHECK (id = 'default'),
    config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object')
);
INSERT INTO pricing_rules VALUES ('default', '{
  "timezone": "Asia/Ho_Chi_Minh",
  "quoteTtlSeconds": 120,
  "roundingVnd": 1000,
  "fallbackSpeedKph": 25,
  "cellSizeKm": 1,
  "surgeRadiusKm": 3,
  "surgeRefreshSeconds": 45,
  "surgeCacheSeconds": 120,
  "maxSurgeMultiplier": 2,
  "surgeTiers": [
    {"ratio": 0, "multiplier": 1},
    {"ratio": 1.5, "multiplier": 1.2},
    {"ratio": 2, "multiplier": 1.5},
    {"ratio": 3, "multiplier": 2}
  ],
  "timeWindows": [
    {"code": "MORNING_PEAK", "label": "Giờ cao điểm", "startHour": 7, "endHour": 9, "multiplier": 1.2},
    {"code": "EVENING_PEAK", "label": "Giờ cao điểm", "startHour": 17, "endHour": 19, "multiplier": 1.2},
    {"code": "NIGHT", "label": "Đêm khuya", "startHour": 22, "endHour": 5, "multiplier": 1.15}
  ],
  "weekendMultiplier": 1.1,
  "rainMultiplier": 1.1
}') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS pricing_holidays (
    holiday_date DATE PRIMARY KEY,
    name TEXT NOT NULL,
    multiplier NUMERIC(4,2) NOT NULL CHECK (multiplier BETWEEN 1 AND 3),
    enabled BOOLEAN NOT NULL DEFAULT TRUE
);
-- Lunar holidays must be entered for each actual calendar year.
INSERT INTO pricing_holidays VALUES
    ('2026-01-01', 'Tết Dương lịch', 1.2, TRUE),
    ('2026-04-30', 'Ngày Thống nhất', 1.2, TRUE),
    ('2026-05-01', 'Ngày Quốc tế Lao động', 1.2, TRUE),
    ('2026-09-02', 'Quốc khánh', 1.2, TRUE)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS pricing_zones (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    radius_km DOUBLE PRECISION NOT NULL CHECK (radius_km > 0 AND radius_km <= 100),
    surcharge INTEGER NOT NULL CHECK (surcharge >= 0),
    enabled BOOLEAN NOT NULL DEFAULT TRUE
);
-- Illustrative zone: disabled until the operator approves the boundary and fee.
INSERT INTO pricing_zones VALUES
    ('SGN', 'Sân bay Tân Sơn Nhất', 10.8188, 106.6519, 2, 15000, FALSE)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS fare_quotes (
    quote_id UUID PRIMARY KEY,
    passenger_id UUID NOT NULL,
    snapshot JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    trip_id UUID UNIQUE REFERENCES trips ("tripId"),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS fare_quotes_expiry_idx ON fare_quotes (expires_at) WHERE trip_id IS NULL;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "vehicleType" TEXT NOT NULL DEFAULT 'MOTORCYCLE'
    CHECK ("vehicleType" IN ('MOTORCYCLE', 'CAR_4_SEAT', 'CAR_7_SEAT'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "quoteId" UUID UNIQUE REFERENCES fare_quotes (quote_id);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "estimatedDuration" NUMERIC(10,2);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "pricingSnapshot" JSONB;
CREATE INDEX IF NOT EXISTS trips_pricing_demand_idx
    ON trips ("vehicleType", ((pickup->>'lat')::DOUBLE PRECISION))
    WHERE status IN ('REQUESTED', 'MATCHING');
