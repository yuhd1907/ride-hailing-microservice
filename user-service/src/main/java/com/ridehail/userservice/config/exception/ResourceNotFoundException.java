package com.ridehail.userservice.config.exception;

/**
 * Exception khi resource không tìm thấy (HTTP 404)
 */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }

}
