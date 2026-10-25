package com.ridehail.driverservice.config.exception;

/**
 * Exception khi xảy ra xung đột tương tranh khi giữ tài xế (HTTP 409 Conflict) Xảy ra khi
 * 2+ request đồng thời cố giữ cùng 1 tài xế
 */
public class DriverConflictException extends RuntimeException {

    public DriverConflictException(String message) {
        super(message);
    }

}
