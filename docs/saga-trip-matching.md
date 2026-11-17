# Saga Trip / Matching / Payment

## 1. Luồng và hợp đồng

`POST /trips` → `trip.requested` → Matching giữ tài xế →
`matching.driver_assigned` → Trip `AWAITING_DRIVER` → `POST /trips/{id}/start`
→ `IN_PROGRESS` → `POST /trips/{id}/complete` → `PAYMENT_PENDING` +
`trip.completed` → Payment trả `payment.succeeded` hoặc `payment.failed`.

Envelope, ID và payload tuân theo [event-schema.md](event-schema.md).
Field khách trong event là `riderId`; cột DB vẫn là `passengerId`.

## 2. Matching

Consume `matching-service.trip.requested`, prefetch 10, manual ack.
Tìm tài xế bằng `GET /internal/drivers/available?lat=…&lng=…&radius=5`.
Lưu `reservationId` và tài xế dự kiến trước khi reserve. Gọi lại cùng reservation
khi lỗi mạng hoặc DB để Driver xử lý idempotent. Khi reserve bị 404/409,
ghi nhận tài xế đã thử để lần retry chọn người khác.

Trong transaction: ghi `processed_events`, cập nhật `matching_requests`, ghi outbox
`matching.driver_assigned`. Chỉ ack sau commit. Hết 3 lần thử chuyển DLQ;
khi có tài xế trở lại có thể redrive message với nguyên `eventId`.

Consume thêm `matching-service.trip.driver_rejected`: nếu lượt ghép đang `ASSIGNED`
đúng tài xế vừa từ chối thì đưa về `PENDING`, bỏ tài xế đã chọn, sinh `reservationId`
mới và giữ tài xế đó trong `attemptedDriverIds`; sau đó chạy lại đúng luồng ghép ở
trên nên tài xế vừa từ chối không được chọn lại dù đã `AVAILABLE`. Message gửi lại
hoặc lời từ chối cũ đến muộn không khớp điều kiện nên không phá lượt ghép mới.
Không còn tài xế nào khác thì message vào DLQ sau 3 lần thử, chuyến nằm ở `MATCHING`.

## 3. API Trip

- `POST /trips`: `{riderId, pickup:{lat,lng}, destination:{lat,lng}, estimatedDistance, fareAmount}`.
- `GET /trips/{id}`: đọc trạng thái và paymentId.
- `POST /trips/{id}/start`: chuyển `AWAITING_DRIVER` → `IN_PROGRESS`, gọi Driver start-trip.
- `POST /trips/{id}/reject`: tài xế đang được ghép từ chối chuyến. Người gọi lấy từ
  header `X-User-Id` do Gateway gắn từ JWT (thiếu → 401, không phải tài xế của chuyến
  → 403); chuyến phải đang `AWAITING_DRIVER` (khác → 409). Trong một transaction: gọi
  `POST /internal/drivers/{driverId}/reject` body `{tripId}` để Driver trả tài xế về
  `AVAILABLE` ngay, chuyển chuyến về `MATCHING`, xóa `driverId`, ghi outbox
  `trip.driver_rejected`. Driver chỉ nhả lượt giữ của đúng `tripId` và trả 200 nếu tài
  xế không còn giữ chuyến đó (idempotent); trả 400 nếu tài xế đã bắt đầu chuyến (Trip
  trả 409). Lỗi mạng/5xx làm rollback, tài xế gọi lại được.
- `POST /trips/{id}/complete`: body `{fareAmount}` tùy chọn, chuyển `IN_PROGRESS`
  → `PAYMENT_PENDING`. Giá cuối cùng > 0, tối đa 2 chữ số thập phân.

Request đầu tiên nhận hoặc tạo UUID `X-Correlation-ID`; các bước tiếp theo giữ
`sagaId` của chuyến. Request trả lại `X-Correlation-ID` để tra log.
API nghiệp vụ đi qua Gateway; `/internal` chỉ gọi trực tiếp qua Eureka.

## 4. Độ tin cậy

Mỗi DB có `processed_events` và `event_outbox`, tự tạo bằng câu lệnh idempotent
khi service khởi động, áp dụng được cho volume DB cũ. Worker chạy mỗi giây,
khóa outbox bằng `FOR UPDATE SKIP LOCKED`, publish bằng confirm channel rồi
đánh dấu đã gửi. Event chỉ nhìn thấy sau commit của transaction nghiệp vụ.
Nếu chết giữa publish và đánh dấu, gửi lại **cùng eventId**; consumer chống trùng.

Queue durable `<service>.<eventType>` có DLX `rideflow.dlx` và DLQ cùng tên thêm
`.dlq`. Message sai envelope/payload vào DLQ ngay. Lỗi tạm thời thử tối đa 3 lần,
đợi 1s rồi 2s, sau đó nack không requeue. Reconnect khai báo lại consumer.

## 5. Bước Trip xử lý kết quả thanh toán

Trong cùng transaction, INSERT processed_events ON CONFLICT DO NOTHING,
khóa chuyến `FOR UPDATE`, kiểm tra rider, driver (nếu có), số tiền và trạng thái.

- `payment.succeeded`: chỉ `PAYMENT_PENDING` → `CONFIRMED`, lưu paymentId,
  history `payment succeeded`, gọi Driver complete-trip. Đã CONFIRMED thì bỏ qua.
- `payment.failed`: chỉ `PAYMENT_PENDING` → `CANCELLED`, lưu paymentId,
  history theo reason. Đã CANCELLED/FAILED thì bỏ qua. Chuyến CONFIRMED không bị
  hủy bởi event lỗi đến muộn.
- Release tài xế trực tiếp tới instance Driver UP tìm qua Eureka, có timeout 5s,
  kèm X-Correlation-ID, không body. 400/404/409/422 coi như đã giải phóng
  (Driver hiện trả 400 khi trạng thái không cho phép release);
  401/403, lỗi mạng hoặc 5xx làm transaction rollback và consumer retry.
- Bù trừ ghi `trip.compensated` vào outbox cùng transaction và correlationId
  của `payment.failed`. Release là tác động ngoài DB, nên sau rollback có thể
  gọi lại; Driver phải tiếp tục bảo đảm release idempotent.

## 6. Kiểm thử

Chạy `node --test scripts/trip-matching.test.js` sau `npm ci` trong hai service.
Xem [hướng dẫn kiểm thử phase 2](phase2-trip-matching.md) và minh chứng trong
`docs/evidence/phase2/trip-matching-tests.txt`.

Luồng tài xế từ chối chạy trên stack Docker thật bằng
`node scripts/check-driver-reject.js` (cần hệ thống đang chạy và `npm ci` trong
`trip-service`); kết quả mẫu ở `docs/evidence/phase3/driver-reject-docker-check.txt`.
