# Demo Phase 3 — Đặt chuyến, từ chối, nhận và hoàn thành

## Chuẩn bị

Chạy tại repo `D:\HTPT\ride-hailing-microservice` trên nhánh
`feature/trip-matching-phase3`. Cần Node.js và Docker Desktop đang chạy.
Giữ `.env` local có cấu hình database, RabbitMQ và `JWT_SECRET` hợp lệ như
`.env.example`; không đưa `.env` vào Git.

```powershell
npm.cmd --prefix trip-service ci
docker compose -f deploy/docker-compose.yml --env-file .env --profile scale up --build -d --wait
node scripts/check-trip-matching-phase3.js --demo
```

Script tự tạo hai tài khoản hành khách và hai tài xế riêng cho lần chạy, đặt
A ngay điểm đón, B cách khoảng 220 m; không in token hay mật khẩu vào minh chứng.
Dữ liệu chuyến được giữ lại để đối chiếu; tài xế trở về offline cuối lần chạy.
Transcript được ghi tại `docs/evidence/phase3/trip-matching-demo.txt`.

Trên máy thiếu dung lượng ổ chứa Docker, sau `gradlew build` và `npm ci` cho
cả Trip/Matching có thể thay lệnh Compose bằng:

```powershell
node scripts/run-trip-matching-local.js --demo
```

Runner này chạy ứng dụng thật từ JAR/Node trên host, hạ tầng trong container
với database tạm trên RAM và tự dọn sau demo. Trường hợp này chỉ giữ transcript
và log, không giữ database. Cần các image hạ tầng đã có sẵn và các cổng đang trống.

## Trình tự thuyết trình

| Bước | Hành động qua Gateway | Điểm cần chỉ ra |
| --- | --- | --- |
| 1 | Hành khách `POST /trips/estimate` với pickup/destination | Km, phút, giá VND, `dynamic-v1`, `quoteId`, hạn giữ giá và lý do tăng giá |
| 2 | `POST /trips` với quoteId, cố gửi giá 1 VND | Trip lưu đúng giá quote; `passengerId` lấy từ JWT |
| 3 | Chờ `GET /trips/{id}` là `AWAITING_DRIVER` | A gần nhất, Driver A là `RESERVED` |
| 4 | A `POST /trips/{id}/reject` | A `AVAILABLE` ngay; Trip về `MATCHING`; RabbitMQ có `trip.driver_rejected` |
| 5 | Chờ lại `AWAITING_DRIVER` | B được giao; A không được chọn lại dù gần hơn |
| 6 | B `POST /trips/{id}/accept` | Trip `IN_PROGRESS`, Driver B `ON_TRIP`; khách hủy lúc này bị `409` |
| 7 | B `POST /trips/{id}/complete`, cố gửi giá khác | Giá không đổi; `trip.completed` lấy giá đã lưu |
| 8 | Chờ `CONFIRMED`; xem `GET /payments/trips/{id}` | Payment `SUCCESS`, số tiền đúng giá bước 1; Driver B `AVAILABLE` |

Script in ID chuyến, A, B, giá và PASS sau mỗi nhóm kiểm tra. Dùng các ID này
để tìm log theo `tripId` hoặc `correlationId`; không cần sửa SQL để diễn demo.

```powershell
docker compose -f deploy/docker-compose.yml --env-file .env logs --tail 100 trip_service matching_service payment_service notification_service
```

Để trình diễn thêm hết tài xế, thông báo thất bại, hủy chuyến trước nhận và
tranh chấp đồng thời:

```powershell
node scripts/check-trip-matching-phase3.js
```

Kết quả ghi ở `docs/evidence/phase3/trip-matching-integration.txt`. Chỉ công bố
PASS khi script kết thúc với `RESULT: ... integration checks PASS`.
