package com.ridehail.notificationservice.simulation;

/**
 * Lỗi tạm thời được giả lập (kênh gửi thông báo timeout). Listener sẽ retry khi gặp lỗi
 * này.
 */
public class SimulatedFailureException extends RuntimeException {

    public SimulatedFailureException(String message) {
        super(message);
    }

}
