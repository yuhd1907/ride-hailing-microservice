# Ride-Hailing Microservice - Hệ thống Gọi xe Mô phỏng Grab/Uber

> **Đề tài DS03** - Các hệ thống phân tán  
> **Tech Stack**: Spring Boot 3 + Hibernate 6 + Gradle Groovy + Netflix Eureka + Redis 7 + PostgreSQL + RabbitMQ

## 📋 Kiến trúc Hệ thống

```
Client → API Gateway (:8080) → Eureka Discovery → Services
                ↕                                    ↕
           Redis (Rate Limit,                   PostgreSQL
           Token Blacklist)                    (Database-per-service)
```

### Danh sách Services

| Service | Port | Mô tả |
|---------|------|-------|
| **Eureka Server** | 8761 | Service Registry & Dashboard |
| **API Gateway** | 8080 | Routing, Rate Limiting, JWT Auth |
| **User Service** | 8081 | Quản lý tài khoản, JWT, Logout |
| **Driver Service 1** | 8082 | Quản lý tài xế (Instance 1) |
| **Driver Service 2** | 18082 | Quản lý tài xế (Instance 2) |
| **Redis** | 6379 | GEO, Token Blacklist, Rate Limit |
| **PostgreSQL (User)** | 5433 | Database user_db |
| **PostgreSQL (Driver)** | 5434 | Database driver_db |
| **RabbitMQ** | 5672/15672 | Message Broker & Management |

### Cổng thống nhất của nhóm

| Service | Cổng service (host) | Cổng DB (host) | Tiền tố route tại Gateway |
|---------|--------------------|----------------|--------------------------|
| api-gateway | 8080 | — | — |
| user-service | 8081 | 5433 | `/auth/**`, `/users/**` |
| driver-service | 8082 | 5434 | `/drivers/**` |
| trip-service | 8083 | 5435 | `/trips/**` |
| matching-service | 8084 | 5436 | `/matching/**` |
| payment-service | 8085 | 5437 | `/payments/**` |
| notification-service | 8086 | 5438 | `/notifications/**` |

Thư mục hiện có source Gateway, User, Driver và Eureka. Route tới cả 6 service
đã được cấu hình qua Eureka (`lb://`). Trip, Matching, Payment và Notification
cần được nhóm bổ sung và đăng ký đúng tên service trước khi gọi API nghiệp vụ;
Gateway trả 503 khi service đích chưa đăng ký.

Các cổng DB là cổng truy cập từ máy host. Container luôn kết nối PostgreSQL
qua tên service và cổng nội bộ `5432`, ví dụ `user_postgres:5432/user_db`.

## 🚀 Hướng dẫn Khởi chạy

### Yêu cầu
- Docker & Docker Compose
- JDK 17 hoặc 21 (build Gradle và chạy `scripts/VerifyCore.java`)
- Node.js >= 18 (tùy chọn, cho các script demo JavaScript có sẵn)

### Build và kiểm thử mã Java

Từ thư mục gốc, chạy toàn bộ 4 module bằng Gradle Wrapper:

```powershell
.\gradlew.bat build
```

Trên Linux/macOS dùng `sh ./gradlew build`. Wrapper cố định Gradle 8.7; các kiểm
thử hồi quy không yêu cầu Docker hoặc database đang chạy. JAR của từng module
nằm trong `<module>/build/libs/<module>-1.0.0.jar`.

### Quy ước code Spring Boot

Cấu trúc code tham khảo RikkeiProject_MD03: service interface và implementation,
DTO request/response riêng, mapper Java và exception tập trung. Xem
[CODE_STYLE.md](CODE_STYLE.md) để biết cấu trúc package và quy ước chi tiết.

```powershell
.\gradlew.bat format
.\gradlew.bat checkFormat
```

`build` tự kiểm tra định dạng bằng Spring Java Format trên source và test
của cả bốn module.

Quy tắc chia commit và viết thông điệp: [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md).

### Trạng thái kiểm chứng

Bốn module đã build thành công; 58 kiểm thử Java và kiểm tra định dạng đã đạt,
gồm kiểm tra Spring context và transaction sau khi tách service interface/impl.
Cấu hình Compose đã được kiểm tra cú pháp với `.env.example`.

Kiểm thử toàn hệ thống bằng Docker, Redis GEO thực tế, RabbitMQ hoạt động và
tương tranh trên hai container Driver cần được chạy trong môi trường triển khai.
Các kịch bản trong lộ trình mô tả mục tiêu và cách kiểm tra; không thay thế kết
quả kiểm thử runtime. Trip, Matching, Payment và Notification hiện có cấu hình
route/database, chưa có source service trong repository.

### Bước 1: Cấu hình môi trường
```bash
cp .env.example .env
# Chỉnh sửa .env nếu cần (mặc định đã sẵn sàng chạy)
```

### Bước 2: Khởi chạy toàn bộ hệ thống
```bash
docker compose up --build -d
```

Chạy thêm instance Driver thứ hai tại cổng `18082` để kiểm thử cân bằng tải:

```bash
docker compose --profile scale up --build -d
```

Chuẩn bị thêm 4 database của Trip/Matching/Payment/Notification (5435–5438):

```bash
docker compose --profile extended up -d trip_postgres matching_postgres payment_postgres notification_postgres
```

### Bước 3: Kiểm tra trạng thái
```bash
# Kiểm tra containers
docker compose ps

# Eureka Dashboard
# Mở trình duyệt: http://localhost:8761

# RabbitMQ Management
# Mở trình duyệt: http://localhost:15672 (guest/guest)
```

### Bước 4: Chờ tất cả services healthy (~30-60 giây)
```bash
docker compose logs -f eureka_server
# Chờ thấy "Started EurekaServerApplication"
```

## 🧪 Kiểm thử

### Kiểm tra các hạng mục khởi động

```bash
curl http://localhost:8080/ping
curl http://localhost:8081/ping
curl http://localhost:8082/ping
curl http://localhost:8080/users/ping
curl http://localhost:8080/drivers/ping
```

Cả 5 URL trả HTTP 200, nội dung `UP`, không cần token. Xem kết nối database,
Redis và RabbitMQ tại `/actuator/health` của từng service. Driver kiểm tra kết
nối RabbitMQ lúc khởi động; cấu hình sai broker sẽ làm startup thất bại.

Flyway tự chạy migration trước Hibernate: User tạo `users`, `user_roles`;
Driver tạo `drivers`, `driver_locations`. Database cũ được baseline ở version 0,
sau đó chạy các migration idempotent, giữ dữ liệu hiện có. Hibernate dùng
`validate` để phát hiện schema không tương thích. Vị trí mới nhất của tài xế
được cập nhật vào `driver_locations` và Redis GEO khi gọi API location.

Kiểm tra tích hợp bằng Java 17+ và Docker CLI, bao gồm schema, RabbitMQ,
6 đích route, cập nhật vị trí và validation:

```bash
java scripts/VerifyCore.java
```

Script dùng fixture riêng và dọn fixture sau kiểm tra. Có thể đổi các URL bằng
`GATEWAY_URL`, `USER_SERVICE_URL`, `DRIVER_SERVICE_URL`; đổi Compose project
bằng `COMPOSE_PROJECT_NAME` và file override bằng `COMPOSE_OVERRIDE_FILE`.

Script tự đăng ký tài khoản kiểm thử, đăng nhập lấy JWT và kiểm tra thu hồi
token khi logout. Khi Docker không phản hồi, script dừng với lỗi sau timeout.

Các API GET `/drivers/**`, `/ping`, `/users/ping`, `/drivers/ping`, đăng ký và
đăng nhập cho phép truy cập công khai. Các API thay đổi tài xế và API hồ sơ
qua Gateway yêu cầu `Authorization: Bearer <token>`. Chỉ được cập nhật hồ sơ
có ID trùng với người dùng trong JWT. Các endpoint service trực tiếp phục vụ
giao tiếp nội bộ/kiểm tra; client sử dụng Gateway để xác thực.

Redis GEO hỗ trợ latitude trong `[-85.05112878, 85.05112878]`, longitude
trong `[-180, 180]`; radius phải là số hữu hạn lớn hơn 0. Tọa độ ngoài miền
này trả 400. Tài xế được giải phóng, hoàn thành chuyến hoặc bật online được
đưa lại vào Redis GEO từ vị trí cuối cùng đã lưu trong PostgreSQL.

Với script demo JavaScript có thay đổi vị trí, đặt JWT đã đăng nhập vào
biến môi trường trước khi chạy:

```powershell
$env:AUTH_TOKEN = '<token từ /auth/login>'
```

Các script demo trả exit code 1 khi kết quả không đạt. Script cân bằng tải và
tương tranh giữa hai instance cần khởi động profile `scale`.

### Test 1: Redis GEO - Tìm kiếm tài xế siêu tốc
```bash
node scripts/test-redis-geo.js
```

### Test 2: Tương tranh - 409 Conflict
```bash
node scripts/test-concurrency.js
```

### Test 3: Cân bằng tải Round-Robin
```bash
node scripts/test-load-balancing.js
```

### Test thủ công với cURL

**Đăng ký:**
```bash
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password@123",
    "fullName": "Nguyen Van Test",
    "phone": "0999888777",
    "role": "ROLE_PASSENGER"
  }'
```

**Đăng nhập:**
```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "passenger1@ridehail.com",
    "password": "Password@123"
  }'
```

**Đăng xuất (Token Blacklist):**
```bash
curl -X POST http://localhost:8080/auth/logout \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```

**Cập nhật vị trí tài xế:**
```bash
curl -X POST http://localhost:8080/drivers/drv_target_01/location \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -d '{"latitude": 21.028511, "longitude": 105.854167}'
```

**Tìm tài xế gần Hồ Gươm (3km):**
```bash
curl "http://localhost:8080/drivers/available?lat=21.0285&lng=105.8542&radius=3" \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```

## 🔑 Tài khoản Test (Seed Data)

| Email | Mật khẩu | Vai trò |
|-------|----------|---------|
| passenger1@ridehail.com | Password@123 | ROLE_PASSENGER |
| passenger2@ridehail.com | Password@123 | ROLE_PASSENGER |
| driver1@ridehail.com | Password@123 | ROLE_DRIVER |

Migration User V2 sửa hash sai của tài khoản mẫu trên database cũ, chỉ khi
hash vẫn trùng hash mẫu lỗi ban đầu; mật khẩu đã được người dùng đổi được giữ lại.

| Driver ID | Tên | Biển số | Trạng thái |
|-----------|-----|---------|------------|
| drv_target_01 | Phạm Minh Đức | 30A-12345 | AVAILABLE |
| drv_target_02 | Hoàng Văn Em | 30B-67890 | AVAILABLE |
| drv_target_03 | Vũ Thị Phương | 30C-11111 | AVAILABLE |

## 📡 API Nội bộ (Handoff Contract cho TV2 & TV3)

| Method | Endpoint | Service gọi | Mục đích |
|--------|----------|-------------|----------|
| GET | `/internal/drivers/available?lat=...&lng=...&radius=5` | Matching (TV2) | Tìm tài xế rảnh qua Redis GEO |
| POST | `/internal/drivers/{id}/reserve` | Matching (TV2) | Giữ tài xế nguyên tử (200/409) |
| POST | `/internal/drivers/{id}/release` | Saga (TV3) | Giải phóng tài xế |
| POST | `/internal/drivers/{id}/start-trip` | Trip (TV2) | Chuyển sang ON_TRIP |
| POST | `/internal/drivers/{id}/complete-trip` | Trip (TV2) | Hoàn tất chuyến |

> ⚠️ Endpoint `/internal/**` bị Gateway chặn từ bên ngoài (403 Forbidden). Chỉ service-to-service gọi trực tiếp.

## 🏗️ Công nghệ Nổi bật

- **Redis GEO**: Tìm kiếm tài xế theo bán kính < 1ms
- **Row-Level Lock PostgreSQL**: Chống book trùng tài xế (409 Conflict)
- **Spring Cloud LoadBalancer**: Round-Robin 50/50 giữa 2 instance
- **Netflix Eureka**: Service Discovery + Web Dashboard
- **JWT Token Blacklist**: Đăng xuất an toàn qua Redis TTL
- **Redis Rate Limiting**: Chống DDoS (10 req/s, burst 20)

## 🛑 Dừng hệ thống
```bash
docker compose down

# Xóa cả volumes (reset database)
docker compose down -v
```
