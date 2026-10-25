-- V1__init_notification.sql
-- Khởi tạo bảng cho Notification Service

CREATE TABLE IF NOT EXISTS notifications (
    id                  UUID            PRIMARY KEY,
    recipient_id        UUID            NOT NULL,
    type                VARCHAR(50)     NOT NULL,
    channel             VARCHAR(20)     NOT NULL CHECK (channel IN ('LOG', 'WEBSOCKET')),
    content             TEXT            NOT NULL,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON notifications(recipient_id);

-- Mỗi event đã xử lý ghi một dòng, dùng để bỏ qua message bị gửi lại (deduplication)
CREATE TABLE IF NOT EXISTS processed_events (
    event_id        UUID            PRIMARY KEY,
    event_type      VARCHAR(100)    NOT NULL,
    processed_at    TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
