package com.ridehail.paymentservice.messaging;

import com.ridehail.paymentservice.config.RabbitConfig;
import com.ridehail.paymentservice.dto.event.TripClosedPayload;
import com.ridehail.paymentservice.dto.event.TripRequestedPayload;
import com.ridehail.paymentservice.service.PaymentAuthorizationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Consumer các event vòng đời chuyến mà Payment cần cho bước khoá tiền của Saga:
 * trip.requested (khoá tiền), trip.cancelled và trip.failed (mở khoá).
 */
@Component
public class TripLifecycleListener {

    private static final Logger log = LoggerFactory.getLogger(TripLifecycleListener.class);

    private final EventReader eventReader;

    private final PaymentAuthorizationService authorizationService;

    private final String instanceId;

    public TripLifecycleListener(EventReader eventReader, PaymentAuthorizationService authorizationService,
            @Value("${eureka.instance.instance-id:${spring.application.name}}") String instanceId) {
        this.eventReader = eventReader;
        this.authorizationService = authorizationService;
        this.instanceId = instanceId;
    }

    @RabbitListener(queues = RabbitConfig.TRIP_REQUESTED_QUEUE)
    public void onTripRequested(Message message) {
        EventEnvelope envelope = this.eventReader.readEnvelope(message, EventTypes.TRIP_REQUESTED);
        TripRequestedPayload payload = this.eventReader.readPayload(envelope, TripRequestedPayload.class);
        try (EventLogContext context = EventLogContext.open(envelope.correlationId(), envelope.eventId(),
                envelope.eventType(), payload.tripId(), this.instanceId)) {
            run(envelope, () -> this.authorizationService.handleTripRequested(envelope, payload));
        }
    }

    @RabbitListener(queues = RabbitConfig.TRIP_CANCELLED_QUEUE)
    public void onTripCancelled(Message message) {
        closed(message, EventTypes.TRIP_CANCELLED);
    }

    @RabbitListener(queues = RabbitConfig.TRIP_FAILED_QUEUE)
    public void onTripFailed(Message message) {
        closed(message, EventTypes.TRIP_FAILED);
    }

    private void closed(Message message, String eventType) {
        EventEnvelope envelope = this.eventReader.readEnvelope(message, eventType);
        TripClosedPayload payload = this.eventReader.readPayload(envelope, TripClosedPayload.class);
        try (EventLogContext context = EventLogContext.open(envelope.correlationId(), envelope.eventId(),
                envelope.eventType(), payload.tripId(), this.instanceId)) {
            run(envelope, () -> this.authorizationService.handleTripClosed(envelope, payload));
        }
    }

    private void run(EventEnvelope envelope, Runnable work) {
        int attempt = RetryAttempts.current();
        log.info("Nhận {} (lần thử {})", envelope.eventType(), attempt);
        try {
            work.run();
        }
        catch (RuntimeException ex) {
            log.warn("Xử lý {} lỗi ở lần thử {}: {}", envelope.eventType(), attempt, ex.getMessage());
            throw ex;
        }
    }

}
