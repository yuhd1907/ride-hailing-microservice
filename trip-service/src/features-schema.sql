-- Tính năng cho tài xế và hỗ trợ khách hàng. Chạy lúc khởi động sau pricing-schema.sql; mọi câu đều idempotent.

-- Bước trong chuyến đang chạy (status vẫn là IN_PROGRESS):
--   NULL/TO_PICKUP: đang tới điểm đón · ARRIVED: đã tới, chờ khách · ON_BOARD: khách đã lên xe.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "tripPhase" TEXT
    CHECK ("tripPhase" IN ('TO_PICKUP', 'ARRIVED', 'ON_BOARD'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "pickedUpAt" TIMESTAMPTZ;
-- Chỉ ghi khi tài xế hủy sau khi đã nhận cuốc (khách hủy được nhận biết qua lịch sử trạng thái).
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT CHECK ("cancelledBy" IN ('PASSENGER', 'DRIVER'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
-- Ghi chú khách gửi tài xế khi đặt xe ("đứng cổng số 2").
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "noteForDriver" TEXT CHECK (char_length("noteForDriver") <= 200);
-- Tuyến đường khách chọn khi đặt (Google encoded polyline). Chỉ để tài xế dẫn đường theo; cước không đổi theo tuyến.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS "routePolyline" TEXT CHECK (char_length("routePolyline") <= 20000);
CREATE INDEX IF NOT EXISTS trips_rejected_driver_idx ON trips USING GIN ("rejectedDriverIds");
CREATE INDEX IF NOT EXISTS trips_recent_pickup_idx ON trips ("createdAt" DESC, "vehicleType");

-- Khách đánh giá tài xế sau chuyến: mỗi chuyến một lần.
CREATE TABLE IF NOT EXISTS trip_ratings (
    "tripId"      UUID PRIMARY KEY REFERENCES trips ("tripId") ON DELETE CASCADE,
    "passengerId" UUID NOT NULL,
    "driverId"    UUID NOT NULL,
    stars         SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    tags          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    comment       TEXT CHECK (char_length(comment) <= 500),
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS trip_ratings_driver_idx ON trip_ratings ("driverId", "createdAt" DESC);

-- Phiếu hỗ trợ / khiếu nại gửi tới trung tâm trợ giúp.
CREATE TABLE IF NOT EXISTS support_tickets (
    id            UUID PRIMARY KEY,
    "userId"      UUID NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('PASSENGER', 'DRIVER')),
    "tripId"      UUID REFERENCES trips ("tripId") ON DELETE SET NULL,
    category      TEXT NOT NULL CHECK (category IN ('PASSENGER_NO_SHOW', 'WRONG_LOCATION', 'WRONG_FARE', 'PAYMENT',
                      'SAFETY', 'DRIVER_BEHAVIOR', 'LOST_ITEM', 'ACCOUNT', 'OTHER')),
    subject       TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
    description   TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
    status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED')),
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON support_tickets ("userId", "createdAt" DESC);
