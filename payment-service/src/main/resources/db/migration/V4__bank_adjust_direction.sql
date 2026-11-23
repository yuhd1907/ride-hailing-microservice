-- V4__bank_adjust_direction.sql
-- Giao dịch điều chỉnh số dư (API nội bộ cho script kiểm thử) ghi rõ chiều tăng/giảm

ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_type_check;

-- Dòng ADJUST cũ: suy chiều từ số dư của giao dịch liền trước cùng tài khoản
UPDATE bank_transactions t
SET type = CASE WHEN t.balance_after >= COALESCE(p.previous_balance, 0) THEN 'ADJUST_UP' ELSE 'ADJUST_DOWN' END
FROM (
    SELECT id, LAG(balance_after) OVER (PARTITION BY user_id ORDER BY created_at, id) AS previous_balance
    FROM bank_transactions
) p
WHERE t.id = p.id AND t.type = 'ADJUST';

ALTER TABLE bank_transactions ADD CONSTRAINT bank_transactions_type_check
    CHECK (type IN ('TOPUP', 'HOLD', 'RELEASE', 'CAPTURE', 'ADJUST_UP', 'ADJUST_DOWN'));
