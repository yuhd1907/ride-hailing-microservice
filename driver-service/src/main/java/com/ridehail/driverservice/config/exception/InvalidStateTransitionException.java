package com.ridehail.driverservice.config.exception;

/**
 * Exception khi chuyển trạng thái tài xế không hợp lệ (HTTP 400)
 */
public class InvalidStateTransitionException extends RuntimeException {

    public InvalidStateTransitionException(String message) {
        super(message);
    }

}
