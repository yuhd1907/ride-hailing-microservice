-- V7__tips.sql
-- Tip cho tài xế: tiền đi thẳng từ tài khoản khách sang ví tài xế, không tính chiết khấu.

ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_type_check;
ALTER TABLE bank_transactions ADD CONSTRAINT bank_transactions_type_check
    CHECK (type IN ('TOPUP', 'HOLD', 'RELEASE', 'CAPTURE', 'ADJUST_UP', 'ADJUST_DOWN', 'EARNING', 'COMMISSION', 'WITHDRAW',
                    'TIP_SENT', 'TIP_RECEIVED'));

-- Mỗi chuyến tip một lần (một dòng gửi của khách, một dòng nhận của tài xế)
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_transactions_tip
    ON bank_transactions (trip_id, user_id, type) WHERE type IN ('TIP_SENT', 'TIP_RECEIVED');
