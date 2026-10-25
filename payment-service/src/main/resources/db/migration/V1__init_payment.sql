-- V1__init_payment.sql
-- Khởi tạo bảng cho Payment Service

CREATE TABLE IF NOT EXISTS payments (
    id                  UUID            PRIMARY KEY,
    trip_id             UUID            NOT NULL,
    rider_id            UUID            NOT NULL,
    amount              NUMERIC(12, 2)  NOT NULL CHECK (amount >= 0),
    status              VARCHAR(20)     NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
    idempotency_key     UUID            NOT NULL UNIQUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_trip_id ON payments(trip_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Mỗi event đã xử lý ghi một dòng, dùng để bỏ qua message bị gửi lại (deduplication)
CREATE TABLE IF NOT EXISTS processed_events (
    event_id        UUID            PRIMARY KEY,
    event_type      VARCHAR(100)    NOT NULL,
    processed_at    TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
