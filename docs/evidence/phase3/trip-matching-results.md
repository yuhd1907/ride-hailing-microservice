# Minh chứng Trip/Matching Phase 3

Ngày chạy: **17/11/2026**, múi giờ Việt Nam (UTC+7).
Nhánh local: `feature/trip-matching-phase3`, gốc `origin/develop` tại `af1f978`.
Kết quả áp dụng cho working tree phase3 hiện tại, chưa tạo commit/push.

## Kết quả đã chạy

| Bộ kiểm tra | Kết quả thực tế | Minh chứng |
| --- | --- | --- |
| Build và khởi động đầy đủ Docker Compose | **17/17 container healthy**, toàn bộ application image build thành công | [Trạng thái Compose](compose-health.jsonl) |
| Gradle build toàn repo, kiểm tra format và test Java | **BUILD SUCCESSFUL**; **117 test PASS**, 0 fail/error/skip | [JUnit tổng hợp](trip-matching-java-tests.json) |
| Node unit, HTTP và Saga/Matching với mock hạ tầng | **28/28 PASS** | [Transcript Node](trip-matching-node-tests.txt) |
| Tích hợp phase3, service và hạ tầng thật | **9/9 nhóm PASS** | [Transcript tích hợp](trip-matching-integration.txt) |
| Hồi quy Saga phase2 với giá tính ở server | **9/9 nhóm PASS** | [Transcript hồi quy](trip-matching-regression.txt) |
| Hồi quy tài xế từ chối, giải phóng và ghép lại | **8/8 nhóm PASS** | [Transcript từ chối](trip-matching-driver-reject.txt) |
| Demo đặt chuyến, xem giá, A từ chối, B nhận và hoàn thành | **4/4 nhóm PASS** | [Transcript demo](trip-matching-demo.txt) |

Tổng: **145 test Java/Node và 30 nhóm tích hợp/demo PASS**. Số nhóm không phải
số assertion: mỗi nhóm tích hợp chứa nhiều kiểm tra HTTP, database và event.

Phân bố test Java trên nền develop từ JUnit XML: Gateway 23, Driver 38, Notification 14,
Payment 17, User 25. Eureka không có source test Java. Một số task Gradle
không đổi được đánh dấu `UP-TO-DATE`; JSON giữ timestamp gốc của các suite.

## Phạm vi tích hợp thực tế

- Đăng ký/đăng nhập qua User và JWT thật tại Gateway; không giả lập danh tính.
- Giá lặp lại ổn định; client gửi giá 1 VND và quãng đường giả vẫn nhận giá
  server. Trong demo, 1,55 km có giá **28.000 VND**, Payment thu đúng 28.000.
- Hành khách không đặt hộ; tài xế không đặt chuyến; người khác không đọc/chuyển
  trạng thái chuyến. Gateway loại header danh tính giả kèm token người khác.
- A gần nhất được giữ, A từ chối và trở về AVAILABLE ngay, B được ghép;
  A không được nhận/từ chối thay B. Kiểm tra history, danh sách đã thử và outbox.
- B nhận thành IN_PROGRESS, hoàn thành rồi Payment SUCCESS/Trip CONFIRMED.
  Repeated start/complete không phát thêm event thu tiền.
- Cả A và B từ chối thì FAILED, đúng hành khách nhận TRIP_FAILED; sự kiện thất
  bại trùng không tạo thêm trip.failed.
- Hủy trước nhận giải phóng tài xế và kết thúc Matching; hủy sau nhận bị 409.
  Event hủy đến trước yêu cầu đặt tạo tombstone, chặn assignment đến muộn.
- Nhận/hủy đồng thời chỉ có một bên thành công. Hai snapshot PostgreSQL có
  cùng version: chỉ một cập nhật thành công, snapshot cũ bị 409, version tăng 1.
- Event persistent có messageId/correlationId đúng; message sai vào DLQ.
  Hồi quy payment failed dùng route dài để vượt ngưỡng, kiểm tra bù trừ và
  thông báo PAYMENT_FAILED/TRIP_COMPENSATED; không ép giá từ client.

## Môi trường và giới hạn xác minh

Build/test Java chạy trên JDK 17 và Gradle 8.7. Nhánh kiểm thử dựa trên
`origin/develop` tại `af1f978`. Toàn bộ service ứng dụng và hạ tầng chạy trong
Docker Compose với profile `scale`: Eureka, Gateway, User, hai Driver, Trip,
Matching, Payment, Notification, sáu PostgreSQL, Redis và RabbitMQ. Không giả
lập response của các service. Các transcript tích hợp/demo ghi runtime là
`Docker Compose; origin/develop af1f978`.

Sau khi dọn cache và bộ cài tạm, đã lấy lại khoảng 6,15 GB trên ổ C, đủ để build
và khởi động thành công toàn bộ stack. Danh sách đường dẫn và số đo thực tế
trong [biên bản dọn dung lượng](system-cleanup.md). Database và `.env` được giữ.
Snapshot Compose ghi đủ 17 container ở trạng thái healthy tại thời điểm chạy
test; dữ liệu test được giữ trong các volume để đối chiếu bằng tripId trong log.

Cache Gradle 8.7 cho repo này đặt trong `.verification/gradle-home/` trên ổ D.
Các cache phục hồi trước đó nằm trong `.verification/c-drive-cache-recovery/`.
Các thư mục này và `.env` không nằm trong Git. Runner tạm trên RAM vẫn là một
lựa chọn cho máy thiếu chỗ; kết quả PASS hiện tại được chạy lại trên stack
Docker đầy đủ, không dùng runner tạm đó.

## Tái chạy

```powershell
# Tại thư mục gốc repo trên ổ D
$env:GRADLE_USER_HOME = Join-Path $PWD '.verification\gradle-home'
.\gradlew.bat build --console=plain --max-workers=2
npm.cmd --prefix trip-service ci
npm.cmd --prefix matching-service ci
node scripts/collect-trip-matching-evidence.js
docker compose -f deploy/docker-compose.yml --env-file .env --profile scale up --build -d --wait
node scripts/check-trip-matching-phase3.js
node scripts/check-trip-matching-integration.js
node scripts/check-driver-reject.js
node scripts/check-trip-matching-phase3.js --demo
```

`collect-trip-matching-evidence.js` chạy Node test và tổng hợp XML Java đã có;
không thay thế việc chạy Gradle trước đó. Các cổng của stack phải trống trước
khi khởi động Compose. Chi tiết API, event và cách chạy runner tạm khi cần xem
[báo cáo](../../phase3-trip-matching.md).

Các kịch bản `--faults` dừng/khôi phục service của script phase2 chưa chạy lại
trong phiên này; không tính vào các kết quả PASS ở trên.
