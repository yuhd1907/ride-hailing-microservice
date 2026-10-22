-- Run while connected to trip_db. Requires PostgreSQL 13+ (gen_random_uuid()).

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
    pickup JSONB NOT NULL,
    destination JSONB NOT NULL,
    "estimatedDistance" NUMERIC(10, 2) NOT NULL CHECK ("estimatedDistance" >= 0),
    fare NUMERIC(12, 2) NOT NULL CHECK (fare >= 0),
    status trip_status NOT NULL DEFAULT 'REQUESTED',
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
