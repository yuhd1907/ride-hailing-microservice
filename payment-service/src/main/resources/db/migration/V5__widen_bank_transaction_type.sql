-- V5__widen_bank_transaction_type.sql
-- 'ADJUST_DOWN' dài 11 ký tự, vượt VARCHAR(10) của cột type
ALTER TABLE bank_transactions ALTER COLUMN type TYPE VARCHAR(20);
