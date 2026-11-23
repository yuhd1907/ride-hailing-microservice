package com.ridehail.paymentservice.config.exception;

/**
 * Yêu cầu hợp lệ nhưng xung đột với trạng thái hiện tại (HTTP 409).
 */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }

}
