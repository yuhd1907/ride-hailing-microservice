package com.ridehail.paymentservice.messaging;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;

import com.ridehail.paymentservice.config.RabbitConfig;
import com.ridehail.paymentservice.entity.OutboxEvent;
import com.ridehail.paymentservice.repository.OutboxEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Publish một lô event trong outbox lên RabbitMQ và chờ broker xác nhận (publisher
 * confirm). Chỉ đánh dấu đã publish khi broker xác nhận, nên event có thể được gửi lại
 * (at-least-once); consumer chống trùng bằng eventId.
 */
@Component
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);

    private static final long CONFIRM_TIMEOUT_MS = 5000;

    private final OutboxEventRepository outboxEventRepository;

    private final RabbitTemplate rabbitTemplate;

    private final int batchSize;

    private final String instanceId;

    public OutboxRelay(OutboxEventRepository outboxEventRepository, RabbitTemplate rabbitTemplate,
            @Value("${payment.outbox.batch-size:50}") int batchSize,
            @Value("${eureka.instance.instance-id:${spring.application.name}}") String instanceId) {
        this.outboxEventRepository = outboxEventRepository;
        this.rabbitTemplate = rabbitTemplate;
        this.batchSize = batchSize;
        this.instanceId = instanceId;
    }

    public int getBatchSize() {
        return this.batchSize;
    }

    /**
     * @return số event đã publish thành công trong lô này
     */
    @Transactional
    public int publishPending() {
        List<OutboxEvent> events = this.outboxEventRepository.findPendingForUpdate(this.batchSize);
        int published = 0;
        for (OutboxEvent event : events) {
            try (EventLogContext context = EventLogContext.open(event.getCorrelationId(), event.getEventId(),
                    event.getEventType(), event.getAggregateId(), this.instanceId)) {
                try {
                    send(event);
                    event.markPublished();
                    published++;
                    log.info("Đã publish {} lên RabbitMQ (số lần lỗi trước đó: {})", event.getEventType(),
                            event.getAttempts());
                }
                catch (AmqpException ex) {
                    event.markFailed(ex.getMessage());
                    log.warn("Chưa publish được {} (lần lỗi thứ {}): {}. Event vẫn nằm trong outbox, sẽ thử lại.",
                            event.getEventType(), event.getAttempts(), ex.getMessage());
                    // Broker đang lỗi: dừng lô này, lần chạy sau thử lại từ event cũ nhất
                    break;
                }
            }
        }
        return published;
    }

    private void send(OutboxEvent event) {
        MessageProperties properties = new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        properties.setContentEncoding(StandardCharsets.UTF_8.name());
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        properties.setMessageId(event.getEventId().toString());
        properties.setType(event.getEventType());
        properties.setCorrelationId(event.getCorrelationId());
        properties.setHeader("x-correlation-id", event.getCorrelationId());
        properties.setTimestamp(Date.from(event.getCreatedAt()));
        Message message = new Message(event.getBody().getBytes(StandardCharsets.UTF_8), properties);
        this.rabbitTemplate.invoke((operations) -> {
            operations.send(RabbitConfig.EVENTS_EXCHANGE, event.getEventType(), message);
            operations.waitForConfirmsOrDie(CONFIRM_TIMEOUT_MS);
            return null;
        });
    }

}
