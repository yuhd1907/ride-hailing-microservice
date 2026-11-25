package com.ridehail.userservice.config.exception;

/**
 * Yêu cầu hợp lệ về định dạng nhưng sai nghiệp vụ (ví dụ mật khẩu hiện tại không đúng) → 400.
 * Không dùng 401 vì web hiểu 401 là phiên đăng nhập hết hạn.
 */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }

}
