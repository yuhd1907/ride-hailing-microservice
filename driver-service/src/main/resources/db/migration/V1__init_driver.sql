-- V1__init_driver.sql
-- Khởi tạo bảng drivers cho Driver Service

CREATE TABLE IF NOT EXISTS drivers (
    id                  VARCHAR(36)     PRIMARY KEY,
    full_name           VARCHAR(100)    NOT NULL,
    phone               VARCHAR(15)     NOT NULL UNIQUE,
    license_plate       VARCHAR(20)     NOT NULL UNIQUE,
    vehicle_type        VARCHAR(30)     NOT NULL DEFAULT 'MOTORCYCLE',
    status              VARCHAR(20)     NOT NULL DEFAULT 'OFFLINE',
    current_trip_id     VARCHAR(36),
    reservation_id      VARCHAR(36),
    version             BIGINT          NOT NULL DEFAULT 0,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index tăng tốc truy vấn
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_phone ON drivers(phone);
CREATE INDEX IF NOT EXISTS idx_drivers_license_plate ON drivers(license_plate);
CREATE INDEX IF NOT EXISTS idx_drivers_current_trip_id ON drivers(current_trip_id);
