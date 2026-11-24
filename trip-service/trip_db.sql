-- Run while connected to trip_db. Requires PostgreSQL 13+ (gen_random_uuid()).
-- Dynamic pricing tables/columns are migrated at startup from src/pricing-schema.sql.

CREATE TYPE trip_status AS ENUM (
    'REQUESTED',
    'MATCHING',
    'AWAITING_DRIVER',
    'PAYMENT_PENDING',
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'FAILED'
);

CREATE TABLE trips (
    "tripId" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "passengerId" UUID NOT NULL,
    "driverId" UUID,
    "rejectedDriverIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    pickup JSONB NOT NULL,
    destination JSONB NOT NULL,
    "estimatedDistance" NUMERIC(10, 2) NOT NULL CHECK ("estimatedDistance" >= 0),
    fare NUMERIC(12, 2) NOT NULL CHECK (fare >= 0),
    status trip_status NOT NULL DEFAULT 'REQUESTED',
    "paymentMethod" VARCHAR(10) NOT NULL DEFAULT 'BANK',
    "originalFare" NUMERIC(12, 2),
    "discountAmount" NUMERIC(12, 2) NOT NULL DEFAULT 0,
    "voucherCode" VARCHAR(30),
    "paymentId" UUID,
    "sagaId" UUID,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trip_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tripId" UUID NOT NULL REFERENCES trips ("tripId") ON DELETE CASCADE,
    previous_status trip_status,
    new_status trip_status NOT NULL,
    reason TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX trips_passenger_id_idx ON trips ("passengerId");
CREATE INDEX trips_driver_id_idx ON trips ("driverId") WHERE "driverId" IS NOT NULL;
CREATE INDEX trips_status_idx ON trips (status);
CREATE INDEX trip_status_history_trip_id_created_at_idx
    ON trip_status_history ("tripId", "createdAt" DESC);

-- Voucher (vouchers, voucher_redemptions) và 4 cột thanh toán ở trên: Trip Service cũng tự tạo
-- lúc khởi động (src/vouchers.js) cho volume cũ.

-- Phase 2: runtime also applies this additive migration for existing databases.
CREATE TABLE IF NOT EXISTS processed_events (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_outbox (
    event_id UUID PRIMARY KEY,
    envelope JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS event_outbox_pending_idx
    ON event_outbox (created_at) WHERE published_at IS NULL;
