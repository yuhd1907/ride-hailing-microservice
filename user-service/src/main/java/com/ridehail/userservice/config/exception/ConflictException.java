package com.ridehail.userservice.config.exception;

/**
 * Exception khi xảy ra xung đột dữ liệu (HTTP 409 Conflict) VD: Email/SĐT đã tồn tại, tài
 * khoản bị khóa
 */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }

}
