package com.ridehail.paymentservice.messaging;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Định kỳ đẩy event trong outbox lên RabbitMQ. Khi RabbitMQ chết, event nằm lại trong
 * database và được gửi tiếp ngay khi broker hoạt động trở lại.
 */
@Component
public class OutboxPublisher {

    private static final Logger log = LoggerFactory.getLogger(OutboxPublisher.class);

    private final OutboxRelay outboxRelay;

    public OutboxPublisher(OutboxRelay outboxRelay) {
        this.outboxRelay = outboxRelay;
    }

    @Scheduled(fixedDelayString = "${payment.outbox.poll-interval-ms:1000}",
            initialDelayString = "${payment.outbox.initial-delay-ms:5000}")
    public void publishPendingEvents() {
        try {
            int published;
            do {
                published = this.outboxRelay.publishPending();
            }
            while (published >= this.outboxRelay.getBatchSize());
        }
        catch (RuntimeException ex) {
            log.warn("Outbox relay tạm dừng: {}", ex.getMessage());
        }
    }

}
