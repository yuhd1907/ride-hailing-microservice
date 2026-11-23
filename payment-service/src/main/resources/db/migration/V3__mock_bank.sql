-- V3__mock_bank.sql
-- Ngân hàng ảo: tài khoản, khoản tạm khoá theo chuyến và lịch sử giao dịch; phương thức thanh toán

ALTER TABLE payments ADD COLUMN IF NOT EXISTS method VARCHAR(10) NOT NULL DEFAULT 'BANK'
    CHECK (method IN ('BANK', 'CASH'));

CREATE TABLE IF NOT EXISTS bank_accounts (
    user_id     UUID            PRIMARY KEY,
    balance     NUMERIC(14, 2)  NOT NULL CHECK (balance >= 0),
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Mỗi chuyến khoá tiền nhiều nhất một lần (UNIQUE trip_id)
CREATE TABLE IF NOT EXISTS fund_holds (
    hold_id     UUID            PRIMARY KEY,
    trip_id     UUID            NOT NULL UNIQUE,
    user_id     UUID            NOT NULL REFERENCES bank_accounts (user_id),
    amount      NUMERIC(12, 2)  NOT NULL CHECK (amount > 0),
    status      VARCHAR(10)     NOT NULL CHECK (status IN ('HELD', 'CAPTURED', 'RELEASED')),
    expires_at  TIMESTAMPTZ     NOT NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fund_holds_user_held ON fund_holds (user_id) WHERE status = 'HELD';
CREATE INDEX IF NOT EXISTS idx_fund_holds_expiry ON fund_holds (expires_at) WHERE status = 'HELD';

CREATE TABLE IF NOT EXISTS bank_transactions (
    id               UUID            PRIMARY KEY,
    user_id          UUID            NOT NULL REFERENCES bank_accounts (user_id),
    type             VARCHAR(10)     NOT NULL CHECK (type IN ('TOPUP', 'HOLD', 'RELEASE', 'CAPTURE', 'ADJUST')),
    amount           NUMERIC(12, 2)  NOT NULL CHECK (amount > 0),
    trip_id          UUID,
    balance_after    NUMERIC(14, 2)  NOT NULL,
    available_after  NUMERIC(14, 2)  NOT NULL,
    created_at       TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_user ON bank_transactions (user_id, created_at DESC);

-- Chuyến đã hủy/thất bại trước khi kịp khoá tiền: trip.requested tới muộn thì không khoá
CREATE TABLE IF NOT EXISTS closed_trips (
    trip_id     UUID            PRIMARY KEY,
    reason      VARCHAR(40)     NOT NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Số dư mẫu: passenger1 đủ tiền, passenger2 ít tiền để demo trường hợp thiếu tiền
INSERT INTO bank_accounts (user_id, balance) VALUES
    ('26a7f8fe-79a8-49ea-a46a-9529e5c3e381', 1000000),
    ('7f8d81b7-9034-4bb5-8d0d-5a2b2196a1b8', 30000)
ON CONFLICT (user_id) DO NOTHING;
