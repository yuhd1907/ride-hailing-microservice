-- V6__driver_wallet.sql
-- Ví tài xế: nhận tiền chuyến trả bằng tài khoản (sau chiết khấu), bị trừ chiết khấu chuyến tiền mặt, rút tiền.

ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_type_check;
ALTER TABLE bank_transactions ADD CONSTRAINT bank_transactions_type_check
    CHECK (type IN ('TOPUP', 'HOLD', 'RELEASE', 'CAPTURE', 'ADJUST_UP', 'ADJUST_DOWN', 'EARNING', 'COMMISSION', 'WITHDRAW'));

-- Chiết khấu chuyến tiền mặt được trừ thẳng vào ví tài xế, nên ví có thể âm (tài xế nợ nền tảng)
-- cho tới khi nạp thêm hoặc có chuyến trả bằng tài khoản. Hành khách vẫn không âm vì code kiểm tra số dư.
ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_balance_check;
ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_balance_check CHECK (balance >= -5000000);

-- Mỗi chuyến chỉ ghi một khoản thu nhập / chiết khấu cho tài xế
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_transactions_driver_settlement
    ON bank_transactions (trip_id, user_id, type) WHERE type IN ('EARNING', 'COMMISSION');
