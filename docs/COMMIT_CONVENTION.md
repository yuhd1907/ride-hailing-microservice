# Quy ước commit

```text
<type>(<scope>): <Description>

[Body]

[Footer]
```

- `type` viết thường: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.
- `scope` xác định phần việc: `build`, `eureka`, `gateway`, `user`, `driver`, `infra`, `core`, `project`.
- Tiêu đề tối đa 50 ký tự, tính cả type và scope; mô tả bắt đầu bằng chữ hoa,
  dùng động từ mệnh lệnh và không kết thúc bằng dấu chấm.
- Phần thân cách tiêu đề một dòng trống, mỗi dòng tối đa 72 ký tự; giải thích
  thay đổi và lý do. Thêm cách thực hiện khi cần cho người review.
- Một commit chứa một phần công việc có thể xem xét độc lập. Tách thay đổi
  nghiệp vụ khỏi việc chỉ định dạng code.
- `style` chỉ dùng khi thay đổi khoảng trắng hoặc định dạng. Thay đổi cấu trúc
  lớp/package dùng `refactor`; service mới dùng `feat`.
- Dùng thời gian commit thực tế. Khoảng cách giữa các commit phục vụ kiểm tra
  từng mốc; không thay thế mô tả và bằng chứng thay đổi trong commit.

Ví dụ:

```text
feat(driver): Add location and reservation APIs

Store the latest location in PostgreSQL and index available drivers
in Redis so nearby searches reflect the current driver state.

Use atomic database updates to reserve a driver and return a conflict
when another request has already reserved that driver.
```

Theo Semantic Versioning, `fix` thường tương ứng bản vá, `feat` tương ứng
phiên bản minor. Thay đổi không tương thích dùng `!` trong tiêu đề hoặc footer
`BREAKING CHANGE:`. Việc tăng phiên bản được thực hiện ở mốc phát hành;
tạo commit không tự thay đổi version của service.
