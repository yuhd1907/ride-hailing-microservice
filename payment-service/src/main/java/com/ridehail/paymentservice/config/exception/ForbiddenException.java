package com.ridehail.paymentservice.config.exception;

/**
 * Exception khi người dùng không có quyền truy cập resource (HTTP 403)
 */
public class ForbiddenException extends RuntimeException {

    public ForbiddenException(String message) {
        super(message);
    }

}
