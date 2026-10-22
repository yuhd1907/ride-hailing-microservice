# Quy ước Spring Boot

Tham khảo cấu trúc của [RikkeiProject_MD03](https://github.com/dth251/RikkeiProject_MD03/tree/aef9162b49f8fdd045a85fa711e897af2e0e671d),
đặc biệt các package `service/impl`, `dto/request`, `dto/response`, `mapper`
và `config/exception`. Quy ước dưới đây áp dụng cho các module hiện có.

## Tổ chức package

```text
com.ridehail.<service>
├── config
│   ├── exception       # Exception nghiệp vụ và @RestControllerAdvice
│   └── security/jwt    # Phát hành và kiểm tra JWT của User Service
├── controller          # Mapping HTTP, @Valid, header và mã trạng thái
├── dto
│   ├── request         # Dữ liệu đầu vào và Bean Validation
│   └── response        # Dữ liệu đầu ra
├── entity              # JPA entity và enum trạng thái
├── mapper              # Chuyển entity thành DTO
├── repository          # Spring Data JPA và truy vấn database
├── service             # Interface nghiệp vụ
│   └── impl            # @Service, transaction và triển khai nghiệp vụ
└── util                # Hàm kiểm tra dữ liệu dùng chung trong service
```

Gateway đặt xử lý reactive trong `filter`; Eureka giữ cấu trúc gọn theo chức năng
đăng ký service. Chỉ tạo package khi có lớp sử dụng.

## Quy ước viết code

- Dependency được truyền qua constructor và lưu trong trường `private final`.
- Service triển khai interface và đánh dấu phương thức bằng `@Override`.
- Transaction đặt trên phương thức implementation; thao tác đọc dùng `readOnly`.
- `AuthService` xử lý đăng ký, đăng nhập, đăng xuất; `UserService` quản lý hồ sơ.
- Mapper Java chuyển entity sang response. Controller trả DTO qua `ResponseEntity`.
- Request dùng `jakarta.validation` và được kiểm tra bằng `@Valid` tại controller.
- Getter, setter và constructor viết bằng Java; enum biểu diễn trạng thái tài khoản/tài xế.
- Import tường minh; sắp xếp theo thư viện Java, dependency, package dự án, static import.
- Tên lớp dùng PascalCase; tên biến và phương thức dùng camelCase; hằng số dùng UPPER_SNAKE_CASE.
- File UTF-8, xuống dòng LF và thụt lề Java bằng 4 dấu cách.

Các đường dẫn API, cổng service, trường JSON và mã HTTP vẫn theo hợp đồng hiện có
của hệ thống ride-hailing. `/ping` trả nội dung `UP`. Việc chuẩn hóa package
không thêm lớp bọc response vào các API đang được service khác sử dụng.

## Format và kiểm tra

[Spring Java Format](https://github.com/spring-io/spring-javaformat) phiên bản `0.0.48`
được cố định trong Gradle. `.springjavaformatconfig` đặt baseline Java 17 và
thụt lề bằng dấu cách; `.editorconfig` thống nhất mã hóa và xuống dòng.

Chạy từ thư mục gốc trên Windows:

```powershell
.\gradlew.bat format
.\gradlew.bat checkFormat
.\gradlew.bat build
```

Trên Linux/macOS, thay `.\gradlew.bat` bằng `sh ./gradlew`.

`format` định dạng cả source và test của bốn module. `checkFormat` kiểm tra định
dạng mà không ghi lại file. `build` chạy kiểm tra định dạng cùng bộ kiểm thử Java;
source sai định dạng khiến build thất bại. Các bản tham khảo và dữ liệu kiểm tra
trong `.verification` nằm ngoài source set.
