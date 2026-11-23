# Giá động và khóa báo giá

Giá được tính ở **Trip Service**, nơi sở hữu hành trình và giá chuyến. Payment
Service nhận `trip.completed.fareAmount` để thu tiền; không tính lại hệ số khi
chuyến kết thúc. Chuyến cũ giữ nguyên giá đã lưu.

## Công thức và dữ liệu

```text
subtotal = giá mở cửa + round(km × giá/km) + round(phút × giá/phút)
multiplier = khung giờ × surge × lịch × thời tiết
giá = làm tròn lên(max(giá tối thiểu, subtotal × multiplier) + phụ phí khu vực)
```

Km và phút làm tròn 2 chữ số trước khi tính tiền. Mặc định tổng giá làm tròn
lên bội 1.000 VND. Hệ số surge tối đa 2×; hệ số khung giờ, lịch và thời tiết
nhân riêng, vì vậy hệ số tổng có thể lớn hơn 2×.

| Dữ liệu | Nơi quản lý | Mặc định mẫu |
| --- | --- | --- |
| Mở cửa, mỗi km, mỗi phút, giá tối thiểu | `fare_rates` theo `vehicle_type` | Xe máy: 12.000 / 10.000 / 300 / 12.000 VND; ô tô 4 chỗ: 20.000 / 14.000 / 500 / 25.000 VND; ô tô 7 chỗ: 25.000 / 17.000 / 600 / 30.000 VND |
| Khung giờ | `pricing_rules.config.timeWindows` | 7–9h và 17–19h: 1,2×; 22–5h: 1,15× |
| Múi giờ | `pricing_rules.config.timezone` | `Asia/Ho_Chi_Minh`, không phụ thuộc timezone container |
| Cung–cầu | `pricing_rules.config.surgeTiers` | Tỷ lệ ≥1,5: 1,2×; ≥2: 1,5×; ≥3: 2× |
| Cuối tuần | `pricing_rules.config.weekendMultiplier` | Thứ Bảy/Chủ nhật: 1,1× |
| Ngày lễ, Tết | `pricing_holidays` | Ngày dương lịch cụ thể; Tết nhập theo từng năm |
| Mưa hiện tại | `pricing_rules.config.rainMultiplier` | 1,1× khi Weather API báo đang mưa |
| Vùng đón | `pricing_zones` | Vùng tròn theo tâm + bán kính, lấy phụ phí lớn nhất nếu chồng lấn |

Giờ bắt đầu được tính, giờ kết thúc không tính: 09:00 và 19:00 hết cao điểm,
05:00 hết đêm khuya. Nếu trùng ngày lễ và cuối tuần, dùng hệ số ngày lễ.
Nếu nhiều khung giờ chồng nhau, dùng hệ số khung giờ lớn nhất.
Vùng sân bay SGN mẫu **chưa bật**; kiểm tra ranh giới và phí rồi mới bật.

Các giá trị seed là cấu hình minh họa cho đồ án, có thể sửa trực tiếp trong DB.
Migration dùng `ON CONFLICT DO NOTHING`, không ghi đè cấu hình khi restart.
Trip đọc lại cấu hình sau tối đa 30 giây; báo giá đã cấp giữ snapshot cũ.
`pricingRevision` là hash của cấu hình/mức giá để đối chiếu phiên bản thực tế.

## Luồng API

Các request đi qua Gateway `:8080` với JWT hành khách.

1. `POST /trips/estimate`:

   ```json
   {
     "pickup": { "lat": 10.77, "lng": 106.70 },
     "destination": { "lat": 10.80, "lng": 106.72 },
     "vehicleType": "MOTORCYCLE"
   }
   ```

   Response chứa `quoteId`, `expiresAt`, `fareAmount`, `estimatedDistance` (km),
   `estimatedDuration` (phút), `breakdown`, `distanceSource`, `surge`, `weather`
   và `notices`. `vehicleType` mặc định là `MOTORCYCLE`, hỗ trợ thêm `CAR_4_SEAT`
   và `CAR_7_SEAT`, đúng hợp đồng Driver Service.

2. Hiển thị giá và từng phần tử `breakdown.reasons`: `label` + `multiplier`
   hoặc `amount`. Ví dụ `Giờ cao điểm ×1,2`, `Nhiều người đặt ×1,5`.
   Dùng `expiresAt` cho bộ đếm; khi hết hạn, lấy báo giá mới và để khách xem giá.

3. `POST /trips` với `{"quoteId":"<quoteId vừa nhận>"}`. Server đọc snapshot
   từ DB; giá, thời gian, khoảng cách, hệ số do client gửi đều không quyết định
   số tiền. Nếu gửi kèm tọa độ/loại xe, chúng phải khớp báo giá.

4. Quote gắn với người đăng nhập, hiệu lực mặc định **120 giây**. Quote sai chủ
   hoặc không tồn tại: `404`; UUID sai: `400`; hết hạn hoặc đổi hành trình/
   loại xe: `409`. Yêu cầu báo giá mới khi đổi điểm đón, điểm đến hoặc loại xe.

5. Thời điểm cấp và kiểm tra hạn quote dùng đồng hồ PostgreSQL để các replica
   đồng ý về hạn dùng. Tạo chuyến khóa dòng quote bằng `SELECT ... FOR UPDATE`,
   rồi đọc lại đồng hồ DB để kiểm tra hạn sau khi đã lấy được khóa. Quote hết
   hạn trong lúc chờ khóa cũng bị từ chối. Insert chuyến,
   đánh dấu quote đã dùng, lịch sử và outbox nằm trong cùng transaction.
   Hai lần bấm đặt với cùng quote chỉ tạo một chuyến và một `trip.requested`.
   Retry quote đã dùng trả chuyến cũ, kể cả sau thời hạn quote.

6. Trip lưu `quoteId`, `vehicleType`, `estimatedDuration`, `pricingSnapshot`.
   `trip.requested` và `trip.driver_rejected` mang loại xe để Matching chọn
   đúng xe cả khi ghép lại. Khi hoàn tất, Trip phát giá từ `trips.fare`;
   Payment và luồng Saga giữ cơ chế chống thu trùng hiện có.

Để tương thích, `POST /trips` không có quoteId vẫn tạo một báo giá mới ở server
và dùng ngay. **Client đã hiển thị giá phải gửi quoteId**, nếu bỏ qua thì không
khóa được giá đã hiển thị. Repo này chưa có frontend; các trường response ở
trên là hợp đồng để frontend hiển thị minh bạch.

## Surge nền và lỗi hạ tầng

Mỗi estimate chỉ đăng ký ô đón đang hoạt động trong Redis và đọc surge cache.
Không đếm chuyến hay gọi Driver API trong request estimate. Worker mặc định
mỗi **45 giây**, chia ô khoảng **1 km**, chỉ xử lý ô có estimate trong 15 phút
gần nhất. Cache phân biệt loại xe và revision cấu hình.

Worker đếm `REQUESTED`/`MATCHING` trong Trip DB, lọc đúng loại xe và bán kính
3 km quanh tâm ô. Nguồn cung lấy từ Driver Service qua Eureka: Redis GEO,
lọc `AVAILABLE` và vị trí còn hạn, sau đó lọc loại xe. Không đọc chéo Driver DB.
Tỷ lệ = số chuyến chờ / số tài xế rảnh. Không có cầu: 1×; có cầu nhưng không
có tài xế: mức trần. Khóa Redis từng ô tránh nhiều instance tính trùng; cache
mặc định tồn tại 120 giây và kiểm tra tuổi dữ liệu trước khi áp dụng.

Ô mới chưa được worker tính dùng **1×**, `SURGE_WARMING_UP`. Redis lỗi hoặc
cache quá hạn cũng dùng 1× và trả notice; không áp dụng phụ phí cung–cầu thiếu
dữ liệu. Có thể mất một chu kỳ nền để một ô mới có surge. Worker lỗi giữ
snapshot còn hạn, sau hạn sẽ về 1×. Quote đã cấp và đặt xe bằng quote vẫn dùng
PostgreSQL khi Redis ngừng hoạt động. Quote chưa dùng hết hạn hơn 24 giờ được
dọn nền; quote đã dùng giữ liên kết với chuyến để retry và kiểm tra giá.

## Routes, Weather và cấu hình chạy

Thêm vào `.env` khi đã bật các API tương ứng và cấp key cho server:

```dotenv
GOOGLE_ROUTES_API_KEY=<key cho Routes API>
GOOGLE_WEATHER_API_KEY=<key cho Weather API, tùy chọn>
```

Routes gọi `computeRoutes`, `TRAFFIC_AWARE`, `DRIVE` cho ô tô và `TWO_WHEELER`
cho MOTORCYCLE; lấy `distanceMeters`, `duration`. Đây là quãng đường/thời gian
dự kiến tại lúc báo giá, không phải số km/phút đo lại sau khi hoàn thành.
Key Routes đã cấu hình nhưng API lỗi/không có đường: trả `503`, để khách lấy
báo giá mới. Không tự thay công thức đo đường trong trường hợp đó.

Chưa cấu hình Routes: Haversine + thời gian từ `fallbackSpeedKph` (25 km/h),
`distanceSource=straight_line_estimate` và `DISTANCE_AND_DURATION_ESTIMATED`.
Frontend cần hiển thị rõ đây là ước tính; chỉ khi có Routes mới có km đường phố
và thời gian theo giao thông. Weather chưa bật/lỗi: hệ số 1×, trả trạng thái
`disabled`/`unavailable`; dữ liệu thời tiết thành công cache theo ô 5 phút.

Docker Compose đã nối Trip với Redis nội bộ. Khi chạy Node trên host, dùng
`REDIS_URL=redis://127.0.0.1:6379`. Khởi động lại các service đã sửa:

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build trip_service matching_service
```

Trip tự áp dụng `trip-service/src/pricing-schema.sql` cho DB mới/cũ trước khi
mở HTTP. Không cần reset volume hoặc xóa dữ liệu. Ví dụ đổi giá và quy tắc:

```sql
UPDATE fare_rates SET per_km = 11000, per_minute = 350 WHERE vehicle_type = 'MOTORCYCLE';
UPDATE pricing_rules SET config = jsonb_set(config, '{weekendMultiplier}', '1.15') WHERE id = 'default';
INSERT INTO pricing_holidays (holiday_date, name, multiplier)
VALUES ('2027-01-01', 'Tết Dương lịch', 1.2)
ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name, multiplier = EXCLUDED.multiplier;
UPDATE pricing_zones SET enabled = TRUE, surcharge = 15000 WHERE code = 'SGN';
```

## Kiểm tra

```powershell
cd trip-service
npm.cmd ci
npm.cmd test
```

Bộ test gồm công thức, ranh giới giờ Việt Nam, trần surge, dữ liệu từng loại xe,
snapshot sau khi đổi rule, bảo vệ quote, hết hạn, SQL migration lặp lại, HTTP
đặt trùng/complete và payment result. PGlite chạy PostgreSQL trong WASM để
kiểm tra SQL, constraint và rollback trên một connection. Redis, Google và
Driver API dùng test doubles; chưa thay thế kiểm thử nhiều replica hoặc toàn
bộ Docker/RabbitMQ/Redis. Các kiểm thử Saga/phân quyền cũ tiếp tục chạy.

Kiểm thử tích hợp trên stack thật (chạy tại thư mục gốc, sau khi các container
đã healthy và Trip/Matching đã được build từ source hiện tại):

```powershell
node scripts/check-dynamic-pricing-integration.js
node scripts/check-trip-matching-phase3.js
node scripts/check-trip-matching-integration.js
```

Script giá động kiểm tra 8 request đặt đồng thời với cùng quote, khóa giá đến
Payment/Notification, ghép và ghép lại đúng loại xe, cùng worker surge thật qua
Redis GEO/PostgreSQL. Phần surge đợi các chu kỳ nền 45 giây, không thay rule
chung. Script chỉ xóa các chuyến fixture do chính lần chạy đó tạo và đưa tài
xế thử nghiệm về offline. Kết quả nằm trong `docs/evidence/dynamic-pricing/`.

Tài liệu API tham chiếu: [Google Routes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes),
[Google Weather](https://developers.google.com/maps/documentation/weather/current-conditions),
[node-redis](https://redis.io/docs/latest/develop/clients/nodejs/).
