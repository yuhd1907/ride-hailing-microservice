package com.ridehail.paymentservice.simulation;

import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.stereotype.Component;

/**
 * Bật lỗi giả lập cho N lần xử lý tiếp theo, dùng để demo retry và dead-letter queue. Chỉ
 * điều khiển qua /internal/payments/faults (Gateway chặn /internal từ bên ngoài).
 */
@Component
public class FaultInjector {

    private final AtomicInteger remainingFailures = new AtomicInteger();

    public void failNext(int count) {
        this.remainingFailures.set(Math.max(0, count));
    }

    public void reset() {
        this.remainingFailures.set(0);
    }

    public int remaining() {
        return this.remainingFailures.get();
    }

    public void beforeExternalCall(String operation) {
        int before = this.remainingFailures.getAndUpdate((value) -> (value > 0) ? value - 1 : 0);
        if (before > 0) {
            throw new SimulatedFailureException(
                    "Giả lập lỗi tạm thời khi gọi " + operation + " (còn " + (before - 1) + " lần lỗi)");
        }
    }

}
