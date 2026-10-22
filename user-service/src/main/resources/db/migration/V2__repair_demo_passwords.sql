-- Repair the original demo password hash only when it was never changed.
UPDATE users
SET password_hash = '$2a$10$G4qMmM/nBCWop2bHfnb9qe92TCnIpBG0xFwijQ8nOjax/zhU7dNOe', version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE (id, email) IN (
    ('usr_passenger_01', 'passenger1@ridehail.com'),
    ('usr_passenger_02', 'passenger2@ridehail.com'),
    ('usr_driver_01', 'driver1@ridehail.com')
)
AND password_hash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
