# RideFlow Web

Ứng dụng Next.js 14 (App Router, TypeScript, Tailwind CSS) gồm hai phần:

| Phần | Đường dẫn | Dành cho |
| --- | --- | --- |
| Web đặt xe | `/` | Khách hàng và tài xế |
| Console kiểm thử | `/console` | Nhóm phát triển: chạy kịch bản phân tán, xem nhật ký request |

## Chạy

Cần Node.js 18.17 trở lên và backend đã chạy bằng Docker Compose (Gateway ở `http://localhost:8080`).

```powershell
cd frontend
npm install
npm run dev        # http://localhost:3001
```

Bản build: `npm run build` rồi `npm start`. Đổi địa chỉ Gateway bằng `.env.local` (xem `.env.example`). Dùng cổng 3001 vì Grafana đã chiếm 3000.

Tài khoản mẫu (mật khẩu `Password@123`): `passenger1@ridehail.com`, `passenger2@ridehail.com` (khách hàng), `driver1@ridehail.com` (tài xế).

## Web đặt xe

### Xác thực và phân quyền

```
Trình duyệt ──cookie httpOnly──▶ Next.js (BFF) ──Bearer JWT──▶ API Gateway ──▶ microservice
```

- Đăng nhập qua `/api/auth/login`: Next.js gọi `POST /auth/login`, đặt JWT vào cookie `rf_session` (httpOnly, SameSite=Lax). JavaScript trên trình duyệt không đọc được token.
- Mọi dữ liệu đi qua proxy `/api/gw/*`: server gắn token từ cookie rồi gọi Gateway. Proxy chỉ cho các nhóm `trips`, `drivers`, `users`, `payments`, `notifications`; `/internal` và `/actuator` bị chặn.
- Đăng xuất gọi `POST /auth/logout`, token bị đưa vào blacklist Redis, cookie bị xóa.

Phân quyền ở ba lớp:

| Lớp | Cách kiểm tra |
| --- | --- |
| Middleware Next.js | `/khach-hang/*` chỉ cho `ROLE_PASSENGER`, `/tai-xe/*` chỉ cho `ROLE_DRIVER`, `/tai-khoan` cần đăng nhập; sai vai trò thì chuyển về trang của vai trò đó |
| Server component | Mỗi trang gọi `requireUser(role)` trước khi lấy dữ liệu |
| Backend | Gateway kiểm tra chữ ký, hạn dùng, blacklist; từng service kiểm tra vai trò và quyền sở hữu (ví dụ chỉ tài xế được giao mới nhận/hoàn thành chuyến, khách khác xem chuyến nhận 403) |

### Các trang

| Vai trò | Trang | Dữ liệu (API → database) |
| --- | --- | --- |
| Khách | `/` trang chủ, `/dang-nhap`, `/dang-ky` (chọn vai trò) | `user_db` |
| Khách hàng | `/khach-hang` đặt xe trên bản đồ | Giá: `POST /trips/estimate`; tài xế gần: `GET /drivers/available` (Redis GEO + `driver_db`); chuyến đang mở: `GET /trips/me` |
| | `/khach-hang/chuyen-di`, `/khach-hang/chuyen-di/{id}` | `GET /trips/me`, `GET /trips/{id}`, `GET /trips/{id}/history` (`trip_db`), tài xế: `GET /drivers/{id}` |
| | `/khach-hang/thanh-toan` | `GET /payments/me`, `GET /payments/trips/{id}` (`payment_db`) |
| | `/khach-hang/thong-bao` | `GET /notifications/me` (`notification_db`) |
| Tài xế | `/tai-xe` bảng điều khiển: bật/tắt nhận cuốc, gửi vị trí, cuốc mới có đếm ngược 60 giây | `GET /drivers/me`, `POST /drivers/me/go-online`, `/location`, `/trips/{id}/accept`, `/reject` |
| | `/tai-xe/chuyen-di`, `/tai-xe/chuyen-di/{id}` (hoàn thành chuyến) | `GET /trips/me`, `POST /trips/{id}/complete` |
| | `/tai-xe/thu-nhap` | Tổng cước các chuyến `CONFIRMED` từ `GET /trips/me` |
| | `/tai-xe/phuong-tien` (tài xế mới khai báo xe) | `GET /drivers/me`, `POST /drivers` |
| Cả hai | `/tai-khoan` | `GET /users/me`, `PUT /users/me` |

Trang theo dõi chuyến tự làm mới mỗi 3 giây cho đến khi chuyến kết thúc.

### Bản đồ và địa chỉ (Google Maps Platform)

Khách hàng **nhập địa chỉ trước**: ô nhập gợi ý địa chỉ trong Việt Nam (Places API New, `AutocompleteSuggestion`), chọn một gợi ý thì hệ thống lấy tọa độ và **ghim lên bản đồ**. Ghim kéo được để chỉnh vị trí đón chính xác; địa chỉ cập nhật theo bằng Geocoding API. Nút "Vị trí của tôi" lấy GPS rồi đổi ra địa chỉ.

Khi đặt xe, `pickup`/`destination` gửi lên dạng `{ lat, lng, address }`. Trip Service chỉ giữ ba trường này (địa chỉ tối đa 200 ký tự, bỏ ký tự điều khiển) và lưu vào cột JSONB của `trip_db`; các trang lịch sử, chi tiết chuyến đọc lại địa chỉ từ DB.

Cấu hình trong `frontend/.env.local` (không commit), rồi khởi động lại `npm run dev`:

```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<key>
NEXT_PUBLIC_GOOGLE_MAP_ID=          # để trống = DEMO_MAP_ID, chỉ dùng khi phát triển
```

Trong Google Cloud Console:

1. Tạo project, bật thanh toán (Google Maps Platform yêu cầu tài khoản thanh toán, có hạn mức miễn phí hàng tháng).
2. Bật **Maps JavaScript API**, **Places API (New)**, **Geocoding API**, **Routes API**.
3. Tạo API key, giới hạn: *Application restrictions* = HTTP referrers (`http://localhost:3001/*` và tên miền thật khi triển khai); *API restrictions* = bốn API trên.
4. (Khuyến nghị khi triển khai) tạo Map ID trong *Map Management* và đặt vào `NEXT_PUBLIC_GOOGLE_MAP_ID`.

Chưa có key thì bản đồ hiện thông báo cấu hình và ô địa chỉ bị khóa; các trang khác vẫn hoạt động.

**Lộ trình.** Bản đồ vẽ đường đi theo đường phố bằng Routes API (`computeRoutes`, xe ô tô, có tính giao thông hiện tại) kèm quãng đường và thời gian dự kiến: khách thấy lộ trình điểm đón → điểm đến; tài xế có cuốc mới thấy lộ trình từ vị trí của mình tới điểm đón. Không tính được lộ trình thì vẽ đường thẳng nét đứt. Giá cước vẫn do Trip Service tính theo khoảng cách đường thẳng (haversine), nên số km trên thẻ giá có thể nhỏ hơn quãng đường của lộ trình.

### Vị trí tài xế (GPS)

| Thời điểm | Hành vi |
| --- | --- |
| Bấm "Bật nhận cuốc" | Lấy một vị trí GPS chính xác (`getCurrentPosition`, độ chính xác cao, không dùng vị trí cũ); không có quyền vị trí thì không cho bật. Gửi vị trí lên Driver Service **trước**, rồi mới `go-online`, để tài xế có ngay trong chỉ mục Redis GEO mà Matching dùng để ghép khách gần |
| Đang trực tuyến (AVAILABLE, RESERVED, ON_TRIP) | `watchPosition` theo dõi liên tục; gửi vị trí khi di chuyển ≥ 15 m, và gửi lại mỗi 20 giây khi đứng yên (Driver Service bỏ vị trí cũ hơn 300 giây) |
| Bấm "Tắt nhận cuốc" | `go-offline`: Driver Service xóa tài xế khỏi chỉ mục tìm kiếm; app dừng `watchPosition` |

Tài xế không tự nhập hay chạm chọn vị trí. Giới hạn của bản web: trình duyệt chỉ cấp GPS khi trang đang mở; trên điện thoại, khi tab chạy nền hoặc màn hình tắt, trình duyệt có thể tạm dừng định vị. Nếu ngừng gửi quá 300 giây, tài xế tự rơi khỏi kết quả tìm kiếm của khách. Theo dõi nền liên tục cần ứng dụng di động gốc.

### Loại xe và giá cước

Khách chọn **Xe máy**, **Ô tô 4 chỗ** hoặc **Ô tô 7 chỗ**. Bảng giá nằm trong bảng `fare_rates` của `trip_db` (tạo và nạp dữ liệu tự động khi Trip Service khởi động); đổi giá bằng cách cập nhật bảng này, Trip Service đọc lại sau tối đa 30 giây.

| Loại xe | Giá mở cửa | Mỗi km |
| --- | --- | --- |
| Xe máy | 12.000 ₫ | 10.000 ₫ |
| Ô tô 4 chỗ | 20.000 ₫ | 15.000 ₫ |
| Ô tô 7 chỗ | 25.000 ₫ | 18.000 ₫ |

Cước = giá mở cửa + km × giá mỗi km, làm tròn lên 1.000 ₫. `POST /trips/estimate` trả giá của mọi loại xe (`options`); `POST /trips` nhận `vehicleType`, tự tính giá ở server và lưu loại xe vào chuyến. Sự kiện `trip.requested` mang `vehicleType`; Matching chỉ ghép tài xế có đúng loại xe đó (bỏ qua tài xế khác loại dù gần hơn), không có thì chuyến chuyển `FAILED`.

### API bổ sung ở Trip Service

| Endpoint | Mô tả |
| --- | --- |
| `GET /trips/me?status=&limit=` | Hành khách: chuyến mình đặt. Tài xế: chuyến được giao cho mình. Tối đa 100, mới nhất trước |
| `GET /trips/{id}/history` | Các mốc trạng thái của chuyến; cùng quy tắc quyền đọc như `GET /trips/{id}` |
| `GET /trips/fare-rates` | Bảng giá theo loại xe đang áp dụng (`fare_rates`) |

## Console kiểm thử (`/console`)

Đăng nhập nhiều tài khoản cùng lúc (token lưu trong `localStorage`, chỉ dùng cho kiểm thử), xem trạng thái service và circuit breaker, chạy 8 kịch bản phân tán tự chấm ĐẠT / KHÔNG ĐẠT (hai khách đặt cùng tài xế, nhận và hủy cùng lúc, từ chối và ghép lại, cân bằng tải, chặn `/internal`, giả mạo header, thu hồi JWT, rate limit), và xem nhật ký request kèm correlationId. Console gọi Gateway qua rewrite `/gw/*`.
