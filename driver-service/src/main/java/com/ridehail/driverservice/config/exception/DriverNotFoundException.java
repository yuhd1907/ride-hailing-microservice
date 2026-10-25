package com.ridehail.driverservice.config.exception;

/**
 * Exception khi không tìm thấy tài xế (HTTP 404)
 */
public class DriverNotFoundException extends RuntimeException {

    public DriverNotFoundException(String message) {
        super(message);
    }

}
