# Tài liệu cấu trúc dự án Ride Hailing Microservice

Tài liệu này mô tả các file hiện có trong repository, nhiệm vụ của từng file và cách các thành phần phối hợp. Nội dung được rà soát theo mã nguồn và cấu hình đang có trong repo.

## 1. Tổng quan cấu trúc

```text
ride-hailing-microservice/
├── .gitignore
├── package.json
├── PROJECT_FILES.md
├── matching-service/
│   ├── Dockerfile
│   ├── matching_db.sql
│   ├── package.json
│   ├── package-lock.json
│   └── src/
│       ├── db.js
│       ├── eureka.js
│       ├── rabbitmq.js
│       └── server.js
└── trip-service/
    ├── Dockerfile
    ├── docker-compose.services.yml
    ├── trip_db.sql
    ├── package.json
    ├── package-lock.json
    └── src/
        ├── db.js
        ├── eureka.js
        ├── rabbitmq.js
        └── server.js
```

Hai thư mục service là hai ứng dụng Node.js độc lập. Mỗi ứng dụng có cấu hình dependency, Dockerfile, mã khởi chạy, module PostgreSQL, module RabbitMQ và module Eureka riêng. Hai schema SQL cũng độc lập: `trip-service` lưu chuyến đi; `matching-service` lưu yêu cầu tìm tài xế.

## 2. File ở thư mục gốc

### `.gitignore`

Khai báo các file/thư mục Git không nên theo dõi: thiết lập IDE cá nhân, HTTP request/query cục bộ, dữ liệu datasource, `node_modules`, `.env` và các file `*.env`. Những file môi trường có thể chứa thông tin nhạy cảm nên không được commit. Hiện repo chưa có file `.env.example` để liệt kê biến cấu hình mẫu.

### `package.json` (thư mục gốc)

Đang khai báo tên gói `trip-service`, phiên bản, entry point `src/server.js`, lệnh `start` và dependencies. Nội dung này giống manifest của service chứ chưa đóng vai trò workspace/monorepo điều phối cả hai service. Khi chạy npm, nên chạy trong thư mục service tương ứng để dùng đúng manifest và lockfile.

### `PROJECT_FILES.md`

Tài liệu hướng dẫn cấu trúc và nhiệm vụ file của repo. Đây là file đang đọc.

## 3. `trip-service/`

Service quản lý thông tin chuyến đi. Database schema có bảng `trips` và lịch sử đổi trạng thái `trip_status_history`.

### `trip-service/package.json`

Manifest npm của trip-service. Lệnh `npm start` chạy `node src/server.js`. Dependencies gồm Express để tạo HTTP server, `pg` để truy cập PostgreSQL, `amqplib` để kết nối RabbitMQ, `eureka-js-client` để đăng ký service và `dotenv` để nạp biến môi trường từ `.env` khi có.

### `trip-service/package-lock.json`

Lockfile npm lưu cây dependency cụ thể đã được phân giải, giúp cài đặt có thể lặp lại giữa các môi trường. Khi cập nhật dependencies bằng npm, lockfile cần được cập nhật cùng `package.json`. Không chỉnh tay file này.

### `trip-service/Dockerfile`

Định nghĩa image cho trip-service: dùng Node.js 22 Alpine, đặt `/app` làm thư mục làm việc, chép manifest, cài production dependencies, chép `src/`, rồi khởi chạy `src/server.js`. File hiện không chép SQL schema vào image; schema được mount bởi Compose.

### `trip-service/docker-compose.services.yml`

Khai báo môi trường chạy gồm hai PostgreSQL (trip và matching), RabbitMQ, trip-service và matching-service. PostgreSQL lần lượt public cổng `5435` và `5436`, RabbitMQ dùng `5672` cho AMQP và `15672` cho giao diện quản trị, hai ứng dụng dùng `8083` và `8084`. Hai volume giữ dữ liệu PostgreSQL qua lần khởi động lại. Healthcheck của database/RabbitMQ được dùng trong `depends_on` của các service.

File này nằm trong `trip-service/`, nhưng các đường dẫn `build: ./trip-service`, `./trip-service/trip_db.sql` và `./matching-service/matching_db.sql` đang viết như thể file Compose nằm ở thư mục gốc. Mặc định Compose phân giải các đường dẫn tương đối theo thư mục dự án (thường là thư mục chứa file Compose đầu tiên); khi chạy file này theo vị trí hiện tại, cần kiểm tra/điều chỉnh các đường dẫn thành `.` cho build trip, `../matching-service` cho build matching, `./trip_db.sql` cho schema trip và `../matching-service/matching_db.sql` cho schema matching.

Compose cũng đặt `EUREKA_HOST=eureka-server` cho hai service nhưng không khai báo service `eureka-server` trong file này. Do đó Eureka cần được chạy riêng hoặc bổ sung vào cấu hình Compose; nếu không, đăng ký Eureka sẽ không thành công. Các service vẫn khởiởi động phần HTTP và thử kết nối RabbitMQ, nhưng việc gọi `eureka.start()` có thể phát sinh lỗi tùy thời điểm/môi trường.

### `trip-service/trip_db.sql`

DDL khởi tạo schema cho database `trip_db` (ghi chú đầu file yêu cầu PostgreSQL 13+). Tạo enum `trip_status` gồm các trạng thái vòng đời chuyến đi; tạo bảng `trips` với hành khách, tài xế, điểm đón/đến dạng JSONB, khoảng cách, giá cước, trạng thái, thông tin thanh toán/saga, version và dấu thời gian; tạo `trip_status_history` để lưu lịch sử chuyển trạng thái và lý do. Các index hỗ trợ truy vấn theo passenger, driver, status và lịch sử mới nhất theo chuyến.

### `trip-service/src/server.js`

Entry point của service. Tạo Express app và HTTP server, lấy cổng từ `TRIP_SERVICE_PORT`, `PORT` hoặc mặc định `8083`. Middleware gán/nhận correlation ID qua `X-Correlation-Id`, trả ID trong response header và ghi log JSON khi request hoàn tất. Endpoint `GET /ping` kiểm tra truy vấn PostgreSQL và exchange RabbitMQ rồi trả trạng thái UP/DOWN. Khi khởi động, service thử kết nối RabbitMQ lặp lại mỗi 3 giây cho tới khi thành công, sau đó bắt đầu Eureka. Khi nhận SIGINT/SIGTERM, server dừng và đóng Eureka, PostgreSQL pool, RabbitMQ.

### `trip-service/src/db.js`

Tạo và xuất PostgreSQL connection pool từ thư viện `pg`. Ưu tiên `DATABASE_URL`; nếu không có thì đọc `DB_USER`, `DB_PASS` hoặc `DB_PASSWORD`, `DB_HOST`, `DB_PORT` (mặc định `5435`) và `DB_NAME`. Ghi log JSON nếu pool phát sinh lỗi nền.

### `trip-service/src/rabbitmq.js`

Quản lý kết nối RabbitMQ dùng `amqplib`. Mặc định URL là `amqp://guest:guest@localhost:5672`, khai báo topic exchange bền vững `rideflow.events`, tự thử kết nối lại sau 3 giây nếu mất kết nối, và cung cấp `publish(routingKey, payload, correlationId)` để phát JSON message có persistent flag/correlation metadata. `server.js` hiện dùng kết nối để health check; chưa gọi `publish()` trong luồng nghiệp vụ nào.

### `trip-service/src/eureka.js`

Tạo Eureka client cho tên ứng dụng `TRIP-SERVICE`, khai báo cổng, hostname, địa chỉ IP, URL health/status `/ping`, địa chỉ Eureka và chu kỳ heartbeat/registry fetch. Cấu hình có thể nhận từ `EUREKA_HOST`, `EUREKA_PORT`, `EUREKA_SERVICE_PATH`, `EUREKA_INSTANCE_IP`. Module chỉ cấu hình và export client; `server.js` gọi `start()`/`stop()`.

## 4. `matching-service/`

Service dành cho ghép chuyến/tìm tài xế. Database schema hiện mô tả yêu cầu matching, danh sách tài xế đã thử và tài xế được chọn.

### `matching-service/package.json`

Manifest npm của matching-service. Lệnh `npm start` chạy `node src/server.js`. Dùng cùng nhóm thư viện như trip-service: Express, PostgreSQL (`pg`), RabbitMQ (`amqplib`), Eureka và dotenv.

### `matching-service/package-lock.json`

Lockfile của dependencies matching-service, giúp các môi trường cài cùng phiên bản dependency đã phân giải. Được npm quản lý; không sửa tay.

### `matching-service/Dockerfile`

Đóng gói matching-service trên Node.js 22 Alpine, cài dependencies production trong `/app`, chép mã nguồn `src/` và chạy `node src/server.js`.

### `matching-service/matching_db.sql`

DDL cho database `matching_db`. Tạo bảng `matching_requests` gồm ID request, `tripId` duy nhất, trạng thái, mảng UUID các tài xế đã thử, tài xế được chọn, reservation ID và bộ đếm lần thử. Index trên `status` hỗ trợ lọc yêu cầu theo trạng thái. Ghi chú đầu file yêu cầu PostgreSQL 13+.

### `matching-service/src/server.js`

Entry point HTTP của matching-service. Cơ chế log JSON và correlation ID tương tự trip-service. Cổng lấy từ `MATCHING_SERVICE_PORT`, `PORT` hoặc mặc định `8084`. Endpoint duy nhất hiện được định nghĩa là `GET /ping`, kiểm tra PostgreSQL và exchange RabbitMQ. Khi chạy, service kết nối RabbitMQ (thử lại mỗi 3 giây), khởi động Eureka và đóng tài nguyên khi nhận SIGINT/SIGTERM. Hiện chưa có endpoint/API hoặc consumer xử lý ghép tài xế trong file này.

### `matching-service/src/db.js`

Tạo và export PostgreSQL pool cho matching-service. Ưu tiên `DATABASE_URL`; fallback dùng các biến DB riêng, với cổng mặc định `5436`. Lỗi pool được ghi dưới dạng log JSON.

### `matching-service/src/rabbitmq.js`

Module RabbitMQ riêng của matching-service. Khai báo cùng topic exchange bền vững `rideflow.events`, tự kết nối lại, hỗ trợ publish message JSON có routing key và correlation ID, đồng thời có hàm đóng kết nối. Hiện server chỉ dựa vào module để kiểm tra health; chưa có luồng publish/subscribe nghiệp vụ.

### `matching-service/src/eureka.js`

Cấu hình Eureka client với tên ứng dụng `MATCHING-SERVICE`, cổng mặc định `8084`, địa chỉ health/status `/ping`, và các biến môi trường Eureka tương tự trip-service. `server.js` chịu trách nhiệm start/stop client.

## 5. Cách các phần phối hợp

1. Docker Compose khởi tạo PostgreSQL trip, PostgreSQL matching và RabbitMQ.
2. Mỗi Node service đọc cấu hình kết nối từ biến môi trường; Docker Compose truyền `DATABASE_URL`, `RABBITMQ_URL` và cổng service.
3. Service tạo HTTP server, kết nối RabbitMQ và đăng ký vào Eureka.
4. `/ping` xác nhận database và RabbitMQ đang truy cập được; Eureka có thể dùng URL này làm health/status endpoint.
5. Các SQL file khởi tạo schema khi volume PostgreSQL còn mới. Nếu volume đã có dữ liệu, image PostgreSQL thường không chạy lại script trong `docker-entrypoint-initdb.d`.

## 6. Biến cấu hình chính

| Biến | Dùng cho | Mặc định/giá trị trong Compose |
|---|---|---|
| `TRIP_SERVICE_PORT` | Cổng trip-service | `8083` |
| `MATCHING_SERVICE_PORT` | Cổng matching-service | `8084` |
| `PORT` | Cổng fallback nếu không có biến riêng | `8083` hoặc `8084` |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL | Compose truyền riêng cho mỗi service |
| `DB_USER`, `DB_PASS`/`DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` | Thông tin DB dạng rời nếu không dùng URL | Port mặc định trip `5435`, matching `5436` |
| `RABBITMQ_URL` | URL kết nối RabbitMQ | `amqp://guest:guest@localhost:5672` nếu không cấu hình |
| `EUREKA_HOST`, `EUREKA_PORT`, `EUREKA_SERVICE_PATH`, `EUREKA_INSTANCE_IP` | Đăng ký service với Eureka | host `localhost`, port `8761`, path `/eureka/apps/` |

## 7. Những điều repo hiện chưa có

- Chưa có file README, file mẫu `.env.example`, gateway, hoặc service Eureka được khai báo trong Compose này.
- Hai server hiện mới cung cấp endpoint `GET /ping`; chưa có API tạo/cập nhật chuyến đi hoặc xử lý matching.
- RabbitMQ đã có phần kết nối và hàm publish, nhưng chưa có consumer/subscriber hay định nghĩa routing key nghiệp vụ trong mã hiện tại.
- `trip-service/docker-compose.services.yml` khai báo cả hai service nhưng các đường dẫn tương đối và Eureka host cần được đối chiếu như ghi chú ở phần Compose trước khi chạy.
