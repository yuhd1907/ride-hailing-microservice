package com.ridehail.notificationservice.messaging;

import java.util.List;
import java.util.UUID;
import java.util.function.Function;

import com.ridehail.notificationservice.config.RabbitConfig;
import com.ridehail.notificationservice.dto.NotificationDraft;
import com.ridehail.notificationservice.dto.event.DriverAssignedPayload;
import com.ridehail.notificationservice.dto.event.PaymentFailedPayload;
import com.ridehail.notificationservice.dto.event.PaymentSucceededPayload;
import com.ridehail.notificationservice.dto.event.TripAcceptedPayload;
import com.ridehail.notificationservice.dto.event.TripCompensatedPayload;
import com.ridehail.notificationservice.dto.event.TripFailedPayload;
import com.ridehail.notificationservice.service.NotificationMessageFactory;
import com.ridehail.notificationservice.service.NotificationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Consumer các event cần báo cho hành khách/tài xế. Lỗi xử lý được retry (mặc định 3
 * lần), hết lượt thì message vào DLQ tương ứng; message không hợp lệ vào DLQ ngay.
 */
@Component
public class NotificationEventListener {

    private static final Logger log = LoggerFactory.getLogger(NotificationEventListener.class);

    private final EventReader eventReader;

    private final NotificationService notificationService;

    private final NotificationMessageFactory messageFactory;

    private final String instanceId;

    public NotificationEventListener(EventReader eventReader, NotificationService notificationService,
            NotificationMessageFactory messageFactory,
            @Value("${eureka.instance.instance-id:${spring.application.name}}") String instanceId) {
        this.eventReader = eventReader;
        this.notificationService = notificationService;
        this.messageFactory = messageFactory;
        this.instanceId = instanceId;
    }

    @RabbitListener(queues = RabbitConfig.DRIVER_ASSIGNED_QUEUE)
    public void onDriverAssigned(Message message) {
        handle(message, EventTypes.DRIVER_ASSIGNED, DriverAssignedPayload.class, (payload) -> {
            requireRider(payload.resolvedRiderId(), EventTypes.DRIVER_ASSIGNED);
            return this.messageFactory.driverAssigned(payload);
        }, DriverAssignedPayload::tripId);
    }

    @RabbitListener(queues = RabbitConfig.PAYMENT_SUCCEEDED_QUEUE)
    public void onPaymentSucceeded(Message message) {
        handle(message, EventTypes.PAYMENT_SUCCEEDED, PaymentSucceededPayload.class,
                this.messageFactory::paymentSucceeded, PaymentSucceededPayload::tripId);
    }

    @RabbitListener(queues = RabbitConfig.PAYMENT_FAILED_QUEUE)
    public void onPaymentFailed(Message message) {
        handle(message, EventTypes.PAYMENT_FAILED, PaymentFailedPayload.class, this.messageFactory::paymentFailed,
                PaymentFailedPayload::tripId);
    }

    @RabbitListener(queues = RabbitConfig.TRIP_COMPENSATED_QUEUE)
    public void onTripCompensated(Message message) {
        handle(message, EventTypes.TRIP_COMPENSATED, TripCompensatedPayload.class, (payload) -> {
            requireRider(payload.resolvedRiderId(), EventTypes.TRIP_COMPENSATED);
            return this.messageFactory.tripCompensated(payload);
        }, TripCompensatedPayload::tripId);
    }

    @RabbitListener(queues = RabbitConfig.TRIP_FAILED_QUEUE)
    public void onTripFailed(Message message) {
        handle(message, EventTypes.TRIP_FAILED, TripFailedPayload.class, this.messageFactory::tripFailed,
                TripFailedPayload::tripId);
    }

    @RabbitListener(queues = RabbitConfig.TRIP_ACCEPTED_QUEUE)
    public void onTripAccepted(Message message) {
        handle(message, EventTypes.TRIP_ACCEPTED, TripAcceptedPayload.class, this.messageFactory::tripAccepted,
                TripAcceptedPayload::tripId);
    }

    private <T> void handle(Message message, String eventType, Class<T> payloadType,
            Function<T, List<NotificationDraft>> composer, Function<T, UUID> tripIdOf) {
        EventEnvelope envelope = this.eventReader.readEnvelope(message, eventType);
        T payload = this.eventReader.readPayload(envelope, payloadType);
        List<NotificationDraft> drafts = composer.apply(payload);
        UUID tripId = tripIdOf.apply(payload);
        try (EventLogContext context = EventLogContext.open(envelope.correlationId(), envelope.eventId(),
                envelope.eventType(), tripId, this.instanceId)) {
            int attempt = RetryAttempts.current();
            log.info("Nhận {} (lần thử {})", eventType, attempt);
            try {
                int sent = this.notificationService.notify(envelope, tripId, drafts);
                log.info("Đã xử lý {}: gửi {} thông báo", eventType, sent);
            }
            catch (RuntimeException ex) {
                log.warn("Xử lý {} lỗi ở lần thử {}: {}", eventType, attempt, ex.getMessage());
                throw ex;
            }
        }
    }

    private static void requireRider(UUID riderId, String eventType) {
        if (riderId == null) {
            throw new InvalidEventException("Payload of " + eventType + " requires riderId");
        }
    }

}
