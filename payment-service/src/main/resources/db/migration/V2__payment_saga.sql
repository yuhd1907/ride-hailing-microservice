-- V2__payment_saga.sql
-- Bổ sung dữ liệu cho Saga thanh toán và bảng outbox để publish event tin cậy

ALTER TABLE payments ADD COLUMN IF NOT EXISTS driver_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(30)
    CHECK (failure_reason IN ('INSUFFICIENT_FUNDS', 'PAYMENT_DECLINED', 'INTERNAL_ERROR'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_payments_rider_id ON payments(rider_id);

-- Outbox: event kết quả thanh toán được ghi cùng transaction với payment,
-- sau đó OutboxRelay mới publish lên RabbitMQ. RabbitMQ chết không làm mất event.
CREATE TABLE IF NOT EXISTS outbox_events (
    event_id        UUID            PRIMARY KEY,
    event_type      VARCHAR(100)    NOT NULL,
    aggregate_id    UUID            NOT NULL,
    correlation_id  VARCHAR(128)    NOT NULL,
    body            TEXT            NOT NULL,
    attempts        INTEGER         NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON outbox_events(created_at) WHERE published_at IS NULL;
