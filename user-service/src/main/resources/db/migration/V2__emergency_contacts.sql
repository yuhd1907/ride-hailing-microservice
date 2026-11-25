-- V2__emergency_contacts.sql
-- Người thân để Trung tâm an toàn liên hệ khi có sự cố trong chuyến (tối đa 3 người mỗi tài khoản).

CREATE TABLE IF NOT EXISTS emergency_contacts (
    id            UUID          PRIMARY KEY,
    user_id       UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name          VARCHAR(100)  NOT NULL,
    phone         VARCHAR(15)   NOT NULL,
    relationship  VARCHAR(30),
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_emergency_contacts_user_phone UNIQUE (user_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user ON emergency_contacts (user_id);
