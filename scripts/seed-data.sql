-- seed-data.sql
-- Dữ liệu mẫu cho kiểm thử (chạy sau khi init schema)
-- Mật khẩu đã hash bằng BCrypt(10) tương ứng 'Password@123'

-- ===== USER SEED DATA (chỉ chạy khi kết nối tới user_db) =====
DO $$
BEGIN
    -- Kiểm tra nếu bảng users tồn tại (tức đang ở user_db)
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') THEN
        INSERT INTO users (id, email, password_hash, full_name, phone, status, version)
        VALUES
            ('26a7f8fe-79a8-49ea-a46a-9529e5c3e381', 'passenger1@ridehail.com', '$2a$10$G4qMmM/nBCWop2bHfnb9qe92TCnIpBG0xFwijQ8nOjax/zhU7dNOe', 'Nguyễn Văn An', '0901234567', 'ACTIVE', 0),
            ('7f8d81b7-9034-4bb5-8d0d-5a2b2196a1b8', 'passenger2@ridehail.com', '$2a$10$G4qMmM/nBCWop2bHfnb9qe92TCnIpBG0xFwijQ8nOjax/zhU7dNOe', 'Trần Thị Bình', '0912345678', 'ACTIVE', 0),
            ('4262f406-517f-492d-9a9a-f80cf21988da', 'driver1@ridehail.com', '$2a$10$G4qMmM/nBCWop2bHfnb9qe92TCnIpBG0xFwijQ8nOjax/zhU7dNOe', 'Lê Văn Cường', '0923456789', 'ACTIVE', 0)
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO user_roles (user_id, role)
        VALUES
            ('26a7f8fe-79a8-49ea-a46a-9529e5c3e381', 'ROLE_PASSENGER'),
            ('7f8d81b7-9034-4bb5-8d0d-5a2b2196a1b8', 'ROLE_PASSENGER'),
            ('4262f406-517f-492d-9a9a-f80cf21988da', 'ROLE_DRIVER')
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
END $$;

-- ===== DRIVER SEED DATA (chỉ chạy khi kết nối tới driver_db) =====
DO $$
BEGIN
    -- Kiểm tra nếu bảng drivers tồn tại (tức đang ở driver_db)
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'drivers') THEN
        INSERT INTO drivers (id, full_name, phone, license_plate, vehicle_type, status, version)
        VALUES
            ('fd699acc-6544-44a9-9634-5396060c61b8', 'Phạm Minh Đức', '0934567890', '30A-12345', 'MOTORCYCLE', 'AVAILABLE', 0),
            ('5e11b65c-36ef-47cd-9019-9db767cf8d01', 'Hoàng Văn Em', '0945678901', '30B-67890', 'CAR_4_SEAT', 'AVAILABLE', 0),
            ('c61fea6d-3478-482f-a405-73cc2d71afe9', 'Vũ Thị Phương', '0956789012', '30C-11111', 'CAR_7_SEAT', 'AVAILABLE', 0),
            ('a2d9df08-02b2-4225-9e64-03c79e3995c5', 'Ngô Quốc Giang', '0967890123', '30D-22222', 'MOTORCYCLE', 'OFFLINE', 0),
            ('73d94b8d-8139-4af7-a854-b145792f33d5', 'Đỗ Hải Hưng', '0978901234', '30E-33333', 'CAR_4_SEAT', 'ON_TRIP', 0)
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;
