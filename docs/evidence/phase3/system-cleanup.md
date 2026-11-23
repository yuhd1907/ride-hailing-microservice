# Dọn dung lượng và tiếp tục kiểm thử — 17/11/2026

Ổ C trước dọn: **82.550.784 byte trống** (khoảng 83 MB).
Sau các bước dọn cache: **6.229.262.336 byte trống** (khoảng 6,23 GB).
Dung lượng thực thu hồi tại mốc này: **6.146.711.552 byte** (khoảng 6,15 GB).
Việc build tiếp theo có thể sử dụng một phần dung lượng vừa thu hồi.

Sau khi build đầy đủ image, khởi động 17 container và chạy lại kiểm thử,
ổ C còn **3.685.703.680 byte trống** (khoảng 3,69 GB / 3,43 GiB).

Các đường dẫn đã dọn, chỉ gồm dữ liệu có thể tạo/tải lại:

| Đường dẫn | Nội dung đã dọn |
| --- | --- |
| `C:\Users\PC\AppData\Local\npm-cache\_cacache` | Cache gói npm đã tải; không xóa package của dự án |
| `C:\Users\PC\AppData\Local\Temp\vscode-stable-user-x64` | Bộ cài VS Code đã tải trong Temp |
| `C:\Users\PC\AppData\Local\Temp\DockerDesktopUpdates` | Bộ cài cập nhật Docker trong Temp |
| `C:\Users\PC\.gradle\caches\9.3.1\transforms` | Kết quả transform Gradle cũ, tự dựng lại khi cần |
| `C:\Users\PC\.gradle\caches\9.6.0\transforms` | Kết quả transform Gradle cũ, tự dựng lại khi cần |
| `C:\Users\PC\AppData\Local\pip\Cache` | Cache tải gói Python; không gỡ gói đã cài |

Không xóa mã nguồn, `.env`, ứng dụng đã cài, file cá nhân hay Docker volume/database.
Không xóa file `docker_data.vhdx` hoặc `swap.vhdx`. Không dùng `docker system
prune --volumes`. Cache Gradle 8.7 cho repo này tiếp tục đặt trên ổ D trong
`.verification/gradle-home/`.

Nhánh phase3 đã được đặt trên `origin/develop` mới nhất (`af1f978`). Toàn bộ mã
trước khi chuyển được giữ trong stash và `.verification/phase3-before-develop/`.
Nhánh local cũ `feature/trip-matching-setup` đã được xóa sau khi kiểm tra mọi
commit đã nằm trong develop; không xóa nhánh remote và không push main/develop.
