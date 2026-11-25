-- Run while connected to matching_db. Requires PostgreSQL 13+ (gen_random_uuid()).

CREATE TABLE matching_requests (
    "matchingRequestId" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tripId" UUID NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (length(btrim(status)) > 0),
    "attemptedDriverIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "selectedDriverId" UUID,
    "reservationId" UUID,
    "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" >= 0)
);

CREATE INDEX matching_requests_status_idx ON matching_requests (status);

-- Tìm tài xế trong tối đa 3 phút (runtime cũng áp dụng migration này cho DB đã có dữ liệu).
ALTER TABLE matching_requests ADD COLUMN IF NOT EXISTS "searchStartedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE matching_requests ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMPTZ;
ALTER TABLE matching_requests ADD COLUMN IF NOT EXISTS context JSONB;
CREATE INDEX IF NOT EXISTS matching_requests_waiting_idx
    ON matching_requests ("nextAttemptAt") WHERE status = 'PENDING' AND "selectedDriverId" IS NULL;

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
