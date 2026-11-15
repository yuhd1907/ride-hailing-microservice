package com.ridehail.paymentservice.messaging;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ridehail.paymentservice.entity.OutboxEvent;
import com.ridehail.paymentservice.repository.OutboxEventRepository;
import org.springframework.stereotype.Component;

/**
 * Ghi event cần publish vào bảng outbox_events. Phải được gọi trong transaction nghiệp vụ
 * để dữ liệu và event cùng được lưu hoặc cùng bị hủy.
 */
@Component
public class OutboxWriter {

    private final OutboxEventRepository outboxEventRepository;

    private final ObjectMapper objectMapper;

    public OutboxWriter(OutboxEventRepository outboxEventRepository, ObjectMapper objectMapper) {
        this.outboxEventRepository = outboxEventRepository;
        this.objectMapper = objectMapper;
    }

    public OutboxEvent enqueue(String eventType, UUID aggregateId, String correlationId, Object payload) {
        UUID eventId = UUID.randomUUID();
        EventEnvelope envelope = new EventEnvelope(eventId, eventType, correlationId, Instant.now(),
                this.objectMapper.valueToTree(payload));
        String body;
        try {
            body = this.objectMapper.writeValueAsString(envelope);
        }
        catch (JsonProcessingException ex) {
            throw new IllegalStateException("Cannot serialize event " + eventType, ex);
        }
        return this.outboxEventRepository.save(new OutboxEvent(eventId, eventType, aggregateId, correlationId, body));
    }

}
