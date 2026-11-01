package com.ridehail.paymentservice.messaging;

import com.ridehail.paymentservice.config.RabbitConfig;
import com.ridehail.paymentservice.dto.event.TripCompletedPayload;
import com.ridehail.paymentservice.service.PaymentService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Consumer của event trip.completed (bước thanh toán trong Saga).
 * <p>
 * Ném exception thì RetryTemplate thử lại (mặc định 3 lần, backoff 1s, 2s); hết lượt thì
 * message vào payment-service.trip.completed.dlq. Message không hợp lệ vào DLQ ngay.
 */
@Component
public class TripCompletedListener {

    private static final Logger log = LoggerFactory.getLogger(TripCompletedListener.class);

    private final EventReader eventReader;

    private final PaymentService paymentService;

    private final String instanceId;

    public TripCompletedListener(EventReader eventReader, PaymentService paymentService,
            @Value("${eureka.instance.instance-id:${spring.application.name}}") String instanceId) {
        this.eventReader = eventReader;
        this.paymentService = paymentService;
        this.instanceId = instanceId;
    }

    @RabbitListener(queues = RabbitConfig.TRIP_COMPLETED_QUEUE)
    public void onTripCompleted(Message message) {
        EventEnvelope envelope = this.eventReader.readEnvelope(message, EventTypes.TRIP_COMPLETED);
        TripCompletedPayload payload = this.eventReader.readPayload(envelope, TripCompletedPayload.class);
        if (payload.resolvedRiderId() == null) {
            throw new InvalidEventException("Payload of trip.completed requires riderId");
        }
        try (EventLogContext context = EventLogContext.open(envelope.correlationId(), envelope.eventId(),
                envelope.eventType(), payload.tripId(), this.instanceId)) {
            int attempt = RetryAttempts.current();
            log.info("Nhận trip.completed (lần thử {}): fareAmount={}", attempt, payload.fareAmount());
            try {
                this.paymentService.handleTripCompleted(envelope, payload);
            }
            catch (RuntimeException ex) {
                log.warn("Xử lý trip.completed lỗi ở lần thử {}: {}", attempt, ex.getMessage());
                throw ex;
            }
        }
    }

}
