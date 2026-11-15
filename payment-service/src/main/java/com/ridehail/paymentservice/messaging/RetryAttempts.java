package com.ridehail.paymentservice.messaging;

import org.springframework.retry.RetryContext;
import org.springframework.retry.support.RetrySynchronizationManager;

/**
 * Lần thử hiện tại của listener (1 là lần đầu), lấy từ RetryTemplate đang bọc listener.
 */
final class RetryAttempts {

    private RetryAttempts() {
    }

    static int current() {
        RetryContext context = RetrySynchronizationManager.getContext();
        return (context != null) ? context.getRetryCount() + 1 : 1;
    }

}
