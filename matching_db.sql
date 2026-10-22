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
