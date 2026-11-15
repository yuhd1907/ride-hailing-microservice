package com.ridehail.notificationservice.config.exception;

/**
 * Exception khi request không mang danh tính người dùng do Gateway gắn (HTTP 401)
 */
public class UnauthorizedException extends RuntimeException {

    public UnauthorizedException(String message) {
        super(message);
    }

}
