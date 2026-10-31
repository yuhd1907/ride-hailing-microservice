# Event Schema — RideFlow

> **Trạng thái:** DRAFT — chờ Thành viên 2 (Trip/Matching) xác nhận.
> Khi TV2 đồng ý, đổi trạng thái thành **AGREED** và ghi ngày ở mục [Lịch sử thay đổi](#lịch-sử-thay-đổi).
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

### 1.6 Retry, dead-letter queue và publish tin cậy

Mọi consumer dùng chung quy ước sau (Payment và Notification đã áp dụng, Trip/Matching làm theo):

| Mục | Quy ước |
|---|---|
| Dead-letter exchange | `rideflow.dlx`, loại **direct**, durable |
| Queue chính | `<service>.<eventType>`, durable, có `x-dead-letter-exchange = rideflow.dlx` và `x-dead-letter-routing-key = <queue>.dlq` |
| Dead-letter queue | `<service>.<eventType>.dlq`, bind vào `rideflow.dlx` với routing key trùng tên queue |
| Retry | Thử lại tại consumer tối đa **3 lần**, backoff 1s rồi 2s. Hết lượt thì reject không requeue để message vào DLQ |
| Message không hợp lệ | (JSON sai, thiếu field bắt buộc, sai `eventType`) vào DLQ **ngay**, không retry |
| Ack | Chỉ ack sau khi transaction xử lý đã commit |
| Message | `delivery_mode = 2` (persistent), `message_id = eventId`, `type = eventType` |
| Publish | Producer ghi event vào bảng outbox cùng transaction nghiệp vụ, relay publish và chờ publisher confirm (Payment Service). Event có thể được gửi lại, consumer phải chống trùng theo `eventId` |

Message trong DLQ được giữ lại để điều tra và có thể replay về queue chính sau khi sửa lỗi
(Payment/Notification có API `/internal/.../dlq/replay`). Chi tiết luồng Saga ở [saga.md](saga.md).

## 2. Danh sách event

| Event | Producer | Consumer |
|---|---|---|
| `trip.completed` | Trip Service (TV2) | Payment Service |
| `matching.driver_assigned` | Matching Service (TV2) | Notification Service |
| `payment.succeeded` | Payment Service | Trip Service (TV2), Notification Service |
| `payment.failed` | Payment Service | Trip Service (TV2), Notification Service |
| `trip.compensated` | Trip Service (TV2) | Notification Service |

### 2.1 `trip.completed`

Chuyến đi kết thúc, cần thu tiền khách.

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `tripId` | UUID | ✔ | |
| `riderId` | UUID | ✔ | khách trả tiền. Payment cũng chấp nhận tên `passengerId` |
| `driverId` | UUID | ✔ | |
| `fareAmount` | number (VND) | ✔ | số tiền cần thu, > 0, tối đa 2 chữ số thập phân |
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
| `driverId` | UUID | | để Trip Service không phải tra lại |
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
| `driverId` | UUID | | tài xế cần giải phóng ở bước bù trừ |
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

## 3. Cần TV2 trả lời trước khi chốt

1. Exchange `rideflow.events` (topic) + routing key = `eventType` — đồng ý?
2. `payload` lồng trong envelope (như trên) hay để phẳng cùng cấp với `eventId`?
3. `trip.completed`: `fareAmount` là số tiền **cuối cùng** khách phải trả (đã gồm phụ phí/khuyến mãi)?
4. `matching.driver_assigned`: có cần thêm tên tài xế / biển số xe để nội dung thông báo đầy đủ hơn không? Nếu có thì đặt tên field.
5. `trip.compensated`: "bù trừ" cụ thể là huỷ chuyến hay đánh dấu nợ? Có cần thêm field trạng thái chuyến sau bù trừ không?
6. Danh sách `reason` của `payment.failed` đã đủ chưa?

## Lịch sử thay đổi

| Ngày | Ai | Thay đổi |
|---|---|---|
| 2026-10-18 | TV Payment/Notification | Bản nháp đầu tiên |
| 2026-10-25 | TV Payment/Notification | Chốt mọi ID là UUID (idempotency key = `tripId`), thêm quy ước Correlation ID và tài khoản RabbitMQ (mục 1.5) |
| 2026-10-31 | TV Payment/Notification | Thêm quy ước retry, DLQ, outbox (mục 1.6); `payment.*` có thêm `driverId`; chấp nhận `passengerId` thay cho `riderId` |
