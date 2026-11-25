-- V3__announcements.sql
-- Thông báo chung của nền tảng (chính sách, bảo trì, khuyến mãi, tin tức) gửi theo nhóm người dùng,
-- khác thông báo theo chuyến ở bảng notifications.

CREATE TABLE IF NOT EXISTS announcements (
    id            UUID          PRIMARY KEY,
    audience      VARCHAR(20)   NOT NULL CHECK (audience IN ('ALL', 'PASSENGER', 'DRIVER')),
    category      VARCHAR(20)   NOT NULL CHECK (category IN ('POLICY', 'MAINTENANCE', 'PROMOTION', 'NEWS')),
    title         VARCHAR(150)  NOT NULL,
    content       TEXT          NOT NULL,
    pinned        BOOLEAN       NOT NULL DEFAULT FALSE,
    published_at  TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_announcements_visible ON announcements (audience, published_at DESC);

-- Dữ liệu mẫu để demo hộp thư thông báo
INSERT INTO announcements (id, audience, category, title, content, pinned, published_at, expires_at) VALUES
    ('0b7c1e1a-5d1f-4f53-9d55-0d3b6b1b0001', 'DRIVER', 'POLICY', 'Chiết khấu nền tảng 20% mỗi chuyến',
     'Từ nay mỗi chuyến hoàn thành được tính chiết khấu 20% trên cước. Chuyến khách trả bằng tài khoản: ví của bạn nhận 80% cước. Chuyến tiền mặt: bạn giữ toàn bộ tiền mặt, 20% chiết khấu được trừ vào ví. Hãy giữ số dư ví dương để tiếp tục nhận cuốc tiền mặt.',
     TRUE, CURRENT_TIMESTAMP - INTERVAL '2 days', NULL),
    ('0b7c1e1a-5d1f-4f53-9d55-0d3b6b1b0002', 'DRIVER', 'NEWS', 'Bản đồ nhu cầu đã có trên bảng điều khiển',
     'Các ô màu cam và đỏ trên bản đồ là khu vực đang có nhiều khách đặt hơn số tài xế rảnh, kèm hệ số giá. Di chuyển tới đó để nhận cuốc nhanh hơn và giá cao hơn.',
     FALSE, CURRENT_TIMESTAMP - INTERVAL '1 day', NULL),
    ('0b7c1e1a-5d1f-4f53-9d55-0d3b6b1b0003', 'ALL', 'MAINTENANCE', 'Bảo trì hệ thống thanh toán 01:00 - 02:00 Chủ nhật',
     'Thanh toán bằng tài khoản có thể chậm trong khung giờ bảo trì. Chuyến tiền mặt không bị ảnh hưởng.',
     FALSE, CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP + INTERVAL '30 days'),
    ('0b7c1e1a-5d1f-4f53-9d55-0d3b6b1b0004', 'PASSENGER', 'PROMOTION', 'Đánh giá tài xế sau mỗi chuyến',
     'Chấm sao và để lại nhận xét sau mỗi chuyến giúp RideFlow ưu tiên những tài xế phục vụ tốt nhất cho bạn.',
     FALSE, CURRENT_TIMESTAMP - INTERVAL '3 hours', NULL),
    ('0b7c1e1a-5d1f-4f53-9d55-0d3b6b1b0005', 'DRIVER', 'POLICY', 'Quy định chờ khách tại điểm đón',
     'Sau khi bấm "Đã đến điểm đón", bạn cần chờ ít nhất 2 phút trước khi báo khách không xuất hiện. Hủy chuyến không có lý do chính đáng làm tăng tỷ lệ hủy và giảm ưu tiên ghép cuốc.',
     FALSE, CURRENT_TIMESTAMP - INTERVAL '5 hours', NULL)
ON CONFLICT (id) DO NOTHING;
