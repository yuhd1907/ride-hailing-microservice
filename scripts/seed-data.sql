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
            ('usr_passenger_01', 'passenger1@ridehail.com', '$2a$10$G4qMmM/nBCWop2bHfnb9qe92TCnIpBG0xFwijQ8nOjax/zhU7dNOe', 'Nguyễn Văn An', '0901234567', 'ACTIVE', 0),
            ('usr_passenger_02', 'passenger2@ridehail.com', '$2a$10$G4qMmM/nBCWop2bHfnb9qe92TCnIpBG0xFwijQ8nOjax/zhU7dNOe', 'Trần Thị Bình', '0912345678', 'ACTIVE', 0),
            ('usr_driver_01', 'driver1@ridehail.com', '$2a$10$G4qMmM/nBCWop2bHfnb9qe92TCnIpBG0xFwijQ8nOjax/zhU7dNOe', 'Lê Văn Cường', '0923456789', 'ACTIVE', 0)
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO user_roles (user_id, role)
        VALUES
            ('usr_passenger_01', 'ROLE_PASSENGER'),
            ('usr_passenger_02', 'ROLE_PASSENGER'),
            ('usr_driver_01', 'ROLE_DRIVER')
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
            ('drv_target_01', 'Phạm Minh Đức', '0934567890', '30A-12345', 'MOTORCYCLE', 'AVAILABLE', 0),
            ('drv_target_02', 'Hoàng Văn Em', '0945678901', '30B-67890', 'CAR_4_SEAT', 'AVAILABLE', 0),
            ('drv_target_03', 'Vũ Thị Phương', '0956789012', '30C-11111', 'CAR_7_SEAT', 'AVAILABLE', 0),
            ('drv_offline_01', 'Ngô Quốc Giang', '0967890123', '30D-22222', 'MOTORCYCLE', 'OFFLINE', 0),
            ('drv_on_trip_01', 'Đỗ Hải Hưng', '0978901234', '30E-33333', 'CAR_4_SEAT', 'ON_TRIP', 0)
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;
