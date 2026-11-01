-- V2__notification_events.sql
-- Lưu event nguồn của mỗi thông báo để truy vết theo chuyến đi và correlationId

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(20)
    CHECK (recipient_role IN ('PASSENGER', 'DRIVER'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS trip_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_notifications_trip_id ON notifications(trip_id);

-- Lớp chống trùng thứ hai: một event chỉ tạo một thông báo cho mỗi người nhận
CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_event_recipient
    ON notifications(event_id, recipient_id) WHERE event_id IS NOT NULL;
