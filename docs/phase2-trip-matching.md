# Kiểm thử Trip / Matching phase 2

## Chuẩn bị

Node 22; chạy `npm ci` trong `trip-service` và `matching-service`.
Chạy `node --test scripts/trip-matching.test.js` tại root.

Kiểm tra tích hợp với PostgreSQL, RabbitMQ, Eureka, Gateway và hai instance
Driver thật:

```powershell
docker compose -f deploy/docker-compose.yml --env-file .env --profile scale up -d --build
node scripts/check-trip-matching-integration.js --faults
```

Chờ các container healthy trước khi chạy script. Script tạo tài khoản/chuyến test
riêng, kiểm tra cân bằng tải, chặn `/internal`, ghép chuyến, hoàn thành, kết quả
thanh toán giả lập, chống trùng và DLQ. `--faults` còn dừng/khởi động lại Trip và
hai Driver để kiểm tra message durable, rollback và retry; bỏ tùy chọn này để chỉ
chạy luồng thông thường. Script chờ Eureka cập nhật registry trước khi gửi lại
event sau khi Driver phục hồi. Dữ liệu test được giữ lại để đối chiếu DB.

Kết quả chạy Docker thực tế nằm trong
`docs/evidence/phase2/trip-matching-docker-check.txt`. Kết quả này kiểm tra phần
Trip/Matching; event kết quả thanh toán được script publish mô phỏng.

Full stack cần Docker, `.env` từ `.env.example`, và bản Payment/Notification
đã triển khai consumer/producer Saga. Tại thời điểm triển khai 2026-11-10,
`origin/develop` ở `445b9dd` mới chứa entity/repository và ping cho hai service
này, chưa có handler `trip.completed` hoặc producer kết quả thanh toán.
Không thể coi full Saga là đã kiểm thử chỉ với branch này.

```powershell
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

Không cần xóa volume DB cũ: service tự tạo bảng outbox/processed_events.
Nếu queue cũ thiếu DLX, kiểm tra và chuyển/xử lý message đang chờ trước khi
xóa riêng queue cũ trên RabbitMQ UI rồi khởi động lại service.

## Luồng thật

Đăng ký/cho tài xế online, cập nhật GPS gần pickup qua API Driver hiện có.
Đặt chuyến (thay rider UUID thật, thêm Authorization khi đi qua Gateway):

```powershell
$cid = [guid]::NewGuid().ToString()
$body = @{ riderId='<rider UUID>'; pickup=@{lat=10.77;lng=106.70}; destination=@{lat=10.78;lng=106.71}; estimatedDistance=3; fareAmount=125000 } | ConvertTo-Json
$trip = Invoke-RestMethod -Method Post http://127.0.0.1:8083/trips -ContentType application/json -Headers @{'X-Correlation-ID'=$cid} -Body $body
$tripId = $trip.tripId
Invoke-RestMethod "http://127.0.0.1:8083/trips/$tripId"+# Chờ AWAITING_DRIVER rồi bắt đầu và hoàn thành:
Invoke-RestMethod -Method Post "http://127.0.0.1:8083/trips/$tripId/start"
Invoke-RestMethod -Method Post "http://127.0.0.1:8083/trips/$tripId/complete" -ContentType application/json -Body '{"fareAmount":125000}'
```

Sau khi merge Payment/Notification Saga: kiểm tra CONFIRMED, payment SUCCESS,
notification; lặp lại với giá 5000000 để kiểm tra CANCELLED, AVAILABLE,
trip.compensated và thông báo. Đọc `/internal/payments?tripId=…` ở 8085 và
`/internal/notifications?tripId=…` ở 8086 nếu bản TV3 có các API này.

## Consumer riêng, trùng và DLQ

Tạo chuyến tới PAYMENT_PENDING trước, dùng số tiền đúng với fare đã complete:

```powershell
$eventId = [guid]::NewGuid().ToString()
$payload = @{paymentId=[guid]::NewGuid().ToString(); tripId=$tripId; riderId=$trip.passengerId; driverId='<driver UUID>'; amount=125000; reason='INSUFFICIENT_FUNDS'; failedAt=(Get-Date).ToUniversalTime().ToString('o')}
.\scripts\publish-event.ps1 -EventType payment.failed -EventId $eventId -CorrelationId $cid -Payload $payload
# Gửi lại đúng eventId; không có history/outbox/release mới:
.\scripts\publish-event.ps1 -EventType payment.failed -EventId $eventId -CorrelationId $cid -Payload $payload
.\scripts\publish-event.ps1 -EventType payment.failed -RawBody '{"eventType":"payment.failed"}'
```

Kiểm tra queue `trip-service.payment.failed.dlq`. Thử lỗi Driver/network để xác
nhận 3 lần xử lý, 1s/2s rồi DLQ; khôi phục Driver rồi redrive nguyên event.
Dừng Trip trước khi publish payment.failed, start lại: message durable được xử lý.
Dừng RabbitMQ sau complete, start lại: outbox gửi trip.completed sau reconnect.
Lưu output thực tế hoặc ảnh UI bằng tên `trip-*` / `matching-*` trong evidence.
