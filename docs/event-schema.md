# Event Schema — RideFlow

> **Trạng thái:** AGREED — TV2 chốt hợp đồng ngày 2026-11-10.
> Các quyết định triển khai TV2 nằm ở mục 3; Payment/Notification cần theo cùng hợp đồng khi tích hợp.
> Sau khi AGREED, mọi thay đổi field phải được cả producer và consumer đồng ý trước khi sửa code.

## 1. Quy ước chung

### 1.1 Broker

| Mục | Giá trị |
|---|---|
| Broker | RabbitMQ |
| Exchange | `rideflow.events` — loại **topic**, durable |
| Routing key | trùng với `eventType` (vd `trip.completed`) |
| Content type | `application/json`, UTF-8 |
| Queue | mỗi consumer tự khai báo queue riêng, đặt tên `<service>.<eventType>`, vd `payment-service.trip.completed` |

Producer chỉ publish lên exchange, không cần biết ai consume. Consumer tự bind queue của mình vào exchange theo routing key.

### 1.2 Tên event

- Dạng `<nguồn>.<việc_đã_xảy_ra>`, chữ thường, động từ ở **quá khứ**: `trip.completed`, `payment.succeeded`.
- Nhiều từ trong một phần dùng gạch dưới: `matching.driver_assigned`.

### 1.3 Envelope (bắt buộc cho mọi message)

```json
{
  "eventId": "8f1c2a4e-5b6d-4e7f-9a0b-1c2d3e4f5a6b",
  "eventType": "trip.completed",
  "correlationId": "3a7b9c1d-2e4f-4a6b-8c0d-1e2f3a4b5c6d",
  "occurredAt": "2026-10-18T09:30:00Z",
  "payload": { }
}
```

| Field | Kiểu | Bắt buộc | Ý nghĩa |
|---|---|---|---|
| `eventId` | UUID (string) | ✔ | ID duy nhất của **message này**. Consumer dùng để chống xử lý trùng (bảng `processed_events`). Gửi lại cùng một event thì **giữ nguyên** `eventId`. |
| `eventType` | string | ✔ | Trùng routing key. |
| `correlationId` | UUID (string) | ✔ | Nối các event cùng một luồng nghiệp vụ. Event đầu tiên của luồng tạo mới; event sinh ra do xử lý event khác thì **copy** `correlationId` của event đó. |
| `occurredAt` | string ISO-8601, UTC (`Z`) | ✔ | Thời điểm sự việc xảy ra (không phải lúc gửi). |
| `payload` | object | ✔ | Dữ liệu riêng của từng event, xem mục 2. |

### 1.4 Kiểu dữ liệu trong payload

| Loại | Quy ước | Ví dụ |
|---|---|---|
| ID | UUID dạng string | `"5b0e..."` |
| Tiền | number, đơn vị **VND**, tối đa 2 chữ số thập phân. Java dùng `BigDecimal`, không dùng `double` | `125000.00` |
| Thời gian | string ISO-8601 UTC | `"2026-10-18T09:30:00Z"` |
| Enum | string IN_HOA | `"INSUFFICIENT_FUNDS"` |

Consumer **bỏ qua field lạ** (Jackson: `FAIL_ON_UNKNOWN_PROPERTIES = false`) để producer thêm field mới mà không làm hỏng consumer cũ. Đổi tên hoặc xoá field = thay đổi phá vỡ, phải thống nhất lại.

### 1.5 ID, Correlation ID và kết nối

- **Mọi ID** (ID nghiệp vụ, `eventId`, `correlationId`, idempotency key) là **UUID**. Trong PostgreSQL dùng cột kiểu `UUID`; Java dùng `java.util.UUID`, Node dùng `crypto.randomUUID()`. Không thêm tiền tố vào giá trị UUID.
- Khi publish, ngoài `correlationId` trong envelope, producer gắn thêm `correlationId` vào **AMQP property** `correlationId` và header `x-correlation-id`, để log của mọi service nối được cùng một luồng.
- Request HTTP dùng header `X-Correlation-ID` (Gateway sinh nếu chưa có), mọi service đọc header này và ghi vào log.
- Tài khoản RabbitMQ chung: `guest` / `guest`, đọc từ biến môi trường (`RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`), không ghi cứng trong code.

### 1.6 Retry và dead-letter

Consumer manual ack, prefetch 10. Queue durable `<service>.<eventType>` có
DLX direct durable `rideflow.dlx`, routing key `<queue>.dlq`; DLQ durable bind
cùng routing key. Message sai JSON/envelope/payload vào DLQ ngay. Lỗi tạm thời
thử tối đa 3 lần, chờ 1s rồi 2s; hết lượt nack không requeue.
Chống trùng qua `processed_events` cùng transaction cập nhật nghiệp vụ;
ack sau commit. Trip/Matching dùng confirm channel và outbox để gửi sau commit.

## 2. Danh sách event

| Event | Producer | Consumer |
|---|---|---|
| `trip.requested` | Trip Service (TV2) | Matching Service (TV2) |
| `trip.completed` | Trip Service (TV2) | Payment Service |
| `matching.driver_assigned` | Matching Service (TV2) | Notification Service |
| `payment.succeeded` | Payment Service | Trip Service (TV2), Notification Service |
| `payment.failed` | Payment Service | Trip Service (TV2), Notification Service |
| `trip.compensated` | Trip Service (TV2) | Notification Service |
| `trip.driver_rejected` | Trip Service (TV2) | Matching Service (TV2) |

### 2.1 `trip.completed`

Chuyến đi kết thúc, cần thu tiền khách.

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `tripId` | UUID | ✔ | |
| `riderId` | UUID | ✔ | khách trả tiền |
| `driverId` | UUID | ✔ | |
| `fareAmount` | number (VND) | ✔ | số tiền cần thu, > 0 |
| `completedAt` | ISO-8601 UTC | ✔ | |

```json
{
  "eventId": "8f1c2a4e-5b6d-4e7f-9a0b-1c2d3e4f5a6b",
  "eventType": "trip.completed",
  "correlationId": "3a7b9c1d-2e4f-4a6b-8c0d-1e2f3a4b5c6d",
  "occurredAt": "2026-10-18T09:30:00Z",
  "payload": {
    "tripId": "5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
    "riderId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "driverId": "d4c3b2a1-6f5e-4b7a-9d8c-5d4c3b2a1f0e",
    "fareAmount": 125000.00,
    "completedAt": "2026-10-18T09:30:00Z"
  }
}
```

Payment Service dùng chính `tripId` làm idempotency key của payment (cột `idempotency_key` kiểu `UUID`, ràng buộc `UNIQUE`) → mỗi chuyến chỉ có một payment, kể cả khi Trip Service publish lại với `eventId` khác.

### 2.2 `matching.driver_assigned`

Đã ghép được tài xế cho chuyến.

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `tripId` | UUID | ✔ | |
| `riderId` | UUID | ✔ | người nhận thông báo |
| `driverId` | UUID | ✔ | |
| `assignedAt` | ISO-8601 UTC | ✔ | |

```json
{
  "eventId": "0c9e8d7f-6a5b-4c3d-2e1f-0a9b8c7d6e5f",
  "eventType": "matching.driver_assigned",
  "correlationId": "3a7b9c1d-2e4f-4a6b-8c0d-1e2f3a4b5c6d",
  "occurredAt": "2026-10-18T09:05:00Z",
  "payload": {
    "tripId": "5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
    "riderId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "driverId": "d4c3b2a1-6f5e-4b7a-9d8c-5d4c3b2a1f0e",
    "assignedAt": "2026-10-18T09:05:00Z"
  }
}
```

### 2.3 `payment.succeeded`

Thu tiền thành công.

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `paymentId` | UUID | ✔ | |
| `tripId` | UUID | ✔ | |
| `riderId` | UUID | ✔ | |
| `amount` | number (VND) | ✔ | |
| `paidAt` | ISO-8601 UTC | ✔ | |

```json
{
  "eventId": "1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a",
  "eventType": "payment.succeeded",
  "correlationId": "3a7b9c1d-2e4f-4a6b-8c0d-1e2f3a4b5c6d",
  "occurredAt": "2026-10-18T09:30:02Z",
  "payload": {
    "paymentId": "7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b",
    "tripId": "5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
    "riderId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "amount": 125000.00,
    "paidAt": "2026-10-18T09:30:02Z"
  }
}
```

### 2.4 `payment.failed`

Thu tiền thất bại. Trip Service nhận event này để chạy bước bù trừ (compensation) và sau đó publish `trip.compensated`.

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `paymentId` | UUID | ✔ | |
| `tripId` | UUID | ✔ | |
| `riderId` | UUID | ✔ | |
| `amount` | number (VND) | ✔ | |
| `reason` | enum string | ✔ | `INSUFFICIENT_FUNDS` \| `PAYMENT_DECLINED` \| `INTERNAL_ERROR` |
| `failedAt` | ISO-8601 UTC | ✔ | |

```json
{
  "eventId": "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
  "eventType": "payment.failed",
  "correlationId": "3a7b9c1d-2e4f-4a6b-8c0d-1e2f3a4b5c6d",
  "occurredAt": "2026-10-18T09:30:02Z",
  "payload": {
    "paymentId": "7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b",
    "tripId": "5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
    "riderId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "amount": 125000.00,
    "reason": "INSUFFICIENT_FUNDS",
    "failedAt": "2026-10-18T09:30:02Z"
  }
}
```

### 2.5 `trip.compensated`

Trip Service đã hoàn tác chuyến sau khi thanh toán thất bại. Notification Service báo cho khách.

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `tripId` | UUID | ✔ | |
| `riderId` | UUID | ✔ | người nhận thông báo |
| `driverId` | UUID | ✔ | |
| `reason` | string | ✔ | copy từ `payment.failed.reason` |
| `compensatedAt` | ISO-8601 UTC | ✔ | |

```json
{
  "eventId": "3f4a5b6c-7d8e-4f9a-0b1c-2d3e4f5a6b7c",
  "eventType": "trip.compensated",
  "correlationId": "3a7b9c1d-2e4f-4a6b-8c0d-1e2f3a4b5c6d",
  "occurredAt": "2026-10-18T09:30:05Z",
  "payload": {
    "tripId": "5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
    "riderId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "driverId": "d4c3b2a1-6f5e-4b7a-9d8c-5d4c3b2a1f0e",
    "reason": "INSUFFICIENT_FUNDS",
    "compensatedAt": "2026-10-18T09:30:05Z"
  }
}
```

### 2.6 `trip.requested`

Trip phát cho Matching sau khi tạo chuyến. Payload bắt buộc: `tripId`, `riderId`
(UUID), `pickup` (`lat`, `lng` dạng number hợp lệ). Có thể kèm `destination`
và `fareAmount`. Queue `matching-service.trip.requested`.
Từ dynamic pricing, Trip luôn gửi `vehicleType` (`MOTORCYCLE` | `CAR_4_SEAT` | `CAR_7_SEAT`):
Matching chỉ ghép tài xế đúng loại xe. Consumer vẫn chấp nhận event cũ thiếu field này và ghép
với mọi loại xe; giá trị khác ba loại trên làm event vào DLQ. `trip.driver_rejected` mang cùng
`vehicleType` để ghép lại đúng loại xe.
Trip consume thêm queue `trip-service.matching.driver_assigned` để gán tài xế.

### 2.7 `trip.driver_rejected`

Tài xế đã được ghép từ chối chuyến (`POST /trips/{id}/reject`). Trip phát event
này sau khi Driver Service đã trả tài xế về `AVAILABLE` và chuyến đã về `MATCHING`.
Matching hủy lượt ghép cũ, loại tài xế vừa từ chối và ghép tài xế khác, rồi phát
lại `matching.driver_assigned`. Queue `matching-service.trip.driver_rejected`.

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `tripId` | UUID | ✔ | |
| `riderId` | UUID | ✔ | |
| `driverId` | UUID | ✔ | tài xế vừa từ chối |
| `pickup` | object `{lat, lng}` | ✔ | điểm đón, dùng để tìm lại tài xế gần |
| `vehicleType` | `MOTORCYCLE` / `CAR_4_SEAT` / `CAR_7_SEAT` | khi có giá động | giữ loại xe khi ghép lại; tương thích event cũ thiếu trường này |
| `rejectedAt` | ISO-8601 UTC | ✔ | |

```json
{
  "eventId": "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
  "eventType": "trip.driver_rejected",
  "correlationId": "3a7b9c1d-2e4f-4a6b-8c0d-1e2f3a4b5c6d",
  "occurredAt": "2026-11-16T09:06:00Z",
  "payload": {
    "tripId": "5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
    "riderId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "driverId": "d4c3b2a1-6f5e-4b7a-9d8c-5d4c3b2a1f0e",
    "pickup": { "lat": 10.77, "lng": 106.7 },
    "rejectedAt": "2026-11-16T09:06:00Z"
  }
}
```

Vì một chuyến có thể được ghép nhiều lần, consumer của `matching.driver_assigned`
có thể nhận nhiều event cho cùng `tripId` (mỗi event một `eventId` và `driverId`).

### 2.8 Phase3: hết tài xế và hủy trước khi nhận

| Event | Producer | Consumer/queue | Payload bắt buộc |
| --- | --- | --- | --- |
| `matching.failed` | Matching | `trip-service.matching.failed` | `tripId`, `riderId`, `reason="NO_AVAILABLE_DRIVERS"`, `failedAt` UTC |
| `trip.failed` | Trip | `notification-service.trip.failed` | `tripId`, `riderId`, `reason="NO_AVAILABLE_DRIVERS"`, `failedAt` UTC |
| `trip.cancelled` | Trip | `matching-service.trip.cancelled` | `tripId`, `riderId`, `cancelledAt` UTC; `driverId` UUID hoặc null |

Envelope và metadata AMQP giữ nguyên. Mỗi queue có DLQ tương ứng qua
`rideflow.dlx`. Hết tài xế là kết quả nghiệp vụ được commit/ACK, không retry
vô hạn. Notification gửi `TRIP_FAILED` cho hành khách từ `trip.failed`.
`matching.driver_assigned` bổ sung `reservationId` UUID; consumer vẫn chấp nhận
event phase2 không có trường này.

Trong phase3, `trip.requested` chứa giá/quãng đường **do Trip tính** từ tọa độ.
`trip.completed.fareAmount` luôn là `trips.fare` đã chốt khi tạo chuyến; client
không được quyết định hoặc sửa số tiền Payment thu.
Chi tiết REST, vòng đời, outbox và nhất quán: [báo cáo phase3](phase3-trip-matching.md).

## 3. Quyết định hợp đồng TV2 (2026-11-10)

1. Đồng ý exchange `rideflow.events` topic durable; routing key bằng eventType.
2. Dữ liệu nghiệp vụ nằm trong `payload` lồng trong envelope bắt buộc.
3. `fareAmount` là giá cuối cùng khách phải trả, VND, > 0, tối đa 2 chữ số thập phân.
4. Phase 2 chỉ dùng driverId; chưa thêm tên tài xế/biển số bắt buộc.
5. Bù trừ chuyển chuyến sang `CANCELLED` và giải phóng tài xế; không đánh dấu nợ,
   không cần field trạng thái bổ sung.
6. Giữ `INSUFFICIENT_FUNDS`, `PAYMENT_DECLINED`, `INTERNAL_ERROR`.

Tên khách thống nhất `riderId` trong event; `passengerId` chỉ là tên cột DB.
`driverId` trong payment result là tùy chọn để tương thích schema TV3 hiện tại;
khi vắng mặt Trip lấy tài xế đã lưu trong DB, khi có thì kiểm tra khớp chuyến.

## Lịch sử thay đổi

| Ngày | Ai | Thay đổi |
|---|---|---|
| 2026-10-18 | TV Payment/Notification | Bản nháp đầu tiên |
| 2026-10-25 | TV Payment/Notification | Chốt mọi ID là UUID (idempotency key = `tripId`), thêm quy ước Correlation ID và tài khoản RabbitMQ (mục 1.5) |
| 2026-11-10 | TV2 Trip/Matching | AGREED; riderId, CANCELLED; trả lời 6 câu hỏi; retry/DLQ, trip.requested và outbox |
| 2026-11-23 | TV2 Trip/Matching | Thêm `vehicleType` tùy chọn vào `trip.requested`, `trip.driver_rejected` |
| 2026-11-16 | TV1 Driver/Gateway (phối hợp TV2) | Thêm `trip.driver_rejected` (mục 2.7) cho luồng tài xế từ chối chuyến; không đổi field của event cũ |
| 2026-11-17 | TV2 Trip/Matching | Phase3: giá server, accept/cancel, `matching.failed`, `trip.failed`, `trip.cancelled`, reservationId tùy chọn |
