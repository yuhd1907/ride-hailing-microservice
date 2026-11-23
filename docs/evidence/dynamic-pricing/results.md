# Kết quả kiểm thử giá động — 23/11/2026

Kiểm thử trên Docker Compose, qua Gateway và các service thật, sử dụng PostgreSQL,
Redis GEO và RabbitMQ. Bản `pricing.js` trong container Trip đã được đối chiếu
SHA-256 với source đã sửa trong workspace.

| Bộ kiểm thử | Kết quả |
| --- | --- |
| `npm.cmd --prefix trip-service test` | 37/37 đạt |
| Gradle `check` toàn bộ Java service | 127 test không lỗi; kiểm tra định dạng đạt |
| `node scripts/check-dynamic-pricing-integration.js` | 10/10 đạt |
| `node scripts/check-trip-matching-phase3.js` | 9/9 đạt |
| `node scripts/check-trip-matching-integration.js` | 9/9 đạt |
| `node scripts/check-dynamic-pricing-integration.js --quote-lock-only` | 1/1 đạt; ca này cũng nằm trong bộ giá động đầy đủ |
| Container thuộc stack ứng dụng | 17/17 healthy sau kiểm thử |
| `git diff --check` | Đạt |

## Kiểm tra lại sau đồng bộ main

Đã chạy `git fetch origin main`. `HEAD`, `main`, `origin/main` và `FETCH_HEAD`
cùng commit `245a6dd`; không có commit mới trên main so với nền đang làm việc.
Không có file unmerged hoặc dấu conflict còn sót trong source. Các thay đổi
giá động trong working tree được giữ nguyên, không cần sửa code thêm trong
lượt kiểm tra lại.

Đã chạy lại 37 test Node, Gradle `check` (bao gồm test và checkFormat), 10 ca giá
động, 9 ca Trip/Matching và 9 ca Payment/Notification Saga; tất cả đạt. Gradle
có tái sử dụng các kết quả UP-TO-DATE còn hợp lệ. Đối chiếu SHA-256 toàn bộ
19 file source Trip và 11 file source Matching trong container: khớp workspace.
Chi tiết commit, thời điểm và kết quả: [retest-main.json](retest-main.json).

## Lỗi đã tái hiện và sửa

**Quote hết hạn khi chờ khóa dòng PostgreSQL vẫn tạo chuyến.** Trước sửa,
`expires_at <= clock_timestamp()` được tính ngay trong `SELECT ... FOR UPDATE`.
PostgreSQL tính biểu thức trước khi chờ khóa, nên request có thể nhận kết quả
cũ sau khi quote đã hết hạn. Test giữ khóa trên một connection, gửi request
đặt chuyến qua Gateway trên connection khác, đợi qua hạn rồi thả khóa. Trước
sửa nhận `201`; sau sửa nhận đúng `409` và quote không liên kết với chuyến nào.

Đã tách kiểm tra thời hạn thành câu lệnh dùng đồng hồ DB **sau khi lấy được
khóa**, vẫn trong transaction tạo chuyến. Retry quote đã dùng vẫn trả chuyến
cũ sau khi hết hạn. Container Trip đã được build lại và toàn bộ các bộ kiểm
thử trong bảng trên chạy đạt với bản sửa.

Bộ kiểm thử Saga cũ gặp `429` khi các bộ kiểm thử chạy song song qua Gateway.
Đã thêm chờ 1,1 giây rồi thử lại, tối đa 5 lần, riêng khi bị giới hạn tần suất;
không đổi rate limit. Bổ sung dọn tài xế thử nghiệm trong `finally` để lỗi giữa
chừng không để tài xế AVAILABLE ngoài ý muốn.

## Phạm vi đã xác minh

- Quote gắn đúng hành khách, hạn 120 giây, chặn tọa độ/loại xe thay đổi và dữ
  liệu giá giả từ client.
- Tám request đặt cùng quote đồng thời chỉ tạo một chuyến và một outbox event.
- Giá đã khóa giữ nguyên qua complete, Payment, Notification và RabbitMQ
  giao lại event.
- Xe máy, ô tô 4 chỗ và 7 chỗ ghép đúng loại; ô tô 4 chỗ giữ loại khi ghép lại.
- Worker thực đếm 6 chuyến chờ/2 tài xế xe máy, loại xe khác, trạng thái khác
  và chuyến ngoài bán kính; Redis có snapshot và TTL thực.
- Có cầu nhưng không có tài xế áp dụng trần surge; hết cầu trở về 1×.
- Saga thành công, thất bại/bù trừ, thông báo, chống trùng, DLQ, phân quyền,
  hủy/nhận tranh chấp và khóa version PostgreSQL.

Routes/Weather chưa có API key trong môi trường chạy nên kiểm thử thật dùng
`straight_line_estimate` và `weather=disabled`. Adapter Google có unit test;
chưa gọi Google API thật. Chưa chạy chế độ `--faults` dừng/khởi động service.
Các chuyến fixture surge đã được xóa, tài xế thử nghiệm đã offline; giữ các
chuyến thanh toán để đối chiếu và không reset volume hay dữ liệu sẵn có.

## Minh chứng

- [Giá động: kết quả có cấu trúc](integration.json) và [log](integration.txt).
- [Ca tranh chấp khóa trước sửa](quote-lock-before-fix.json),
  [sau sửa](quote-lock.json).
- [Saga Payment/Notification](saga-integration.txt).
- [Trip/Matching](../phase3/trip-matching-integration.txt).
- [Trạng thái container](container-health.txt).
