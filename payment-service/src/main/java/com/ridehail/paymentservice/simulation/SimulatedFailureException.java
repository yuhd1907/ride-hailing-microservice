package com.ridehail.paymentservice.simulation;

/**
 * Lỗi tạm thời được giả lập (cổng thanh toán timeout). Listener sẽ retry khi gặp lỗi này.
 */
public class SimulatedFailureException extends RuntimeException {

    public SimulatedFailureException(String message) {
        super(message);
    }

}
