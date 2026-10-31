package com.ridehail.paymentservice.messaging;

import java.io.IOException;
import java.time.Instant;
import java.util.Set;
import java.util.stream.Collectors;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.springframework.amqp.core.Message;
import org.springframework.stereotype.Component;

/**
 * Đọc envelope và payload từ message RabbitMQ, kiểm tra dữ liệu bắt buộc. Message không
 * hợp lệ ném {@link InvalidEventException} để đi thẳng vào dead-letter queue.
 */
@Component
public class EventReader {

    private final ObjectMapper objectMapper;

    private final Validator validator;

    public EventReader(ObjectMapper objectMapper, Validator validator) {
        this.objectMapper = objectMapper;
        this.validator = validator;
    }

    public EventEnvelope readEnvelope(Message message, String expectedType) {
        EventEnvelope envelope;
        try {
            envelope = this.objectMapper.readValue(message.getBody(), EventEnvelope.class);
        }
        catch (IOException ex) {
            throw new InvalidEventException("Message is not a valid event envelope: " + ex.getMessage());
        }
        if (envelope == null || envelope.eventId() == null) {
            throw new InvalidEventException("Event envelope requires eventId");
        }
        if (envelope.payload() == null || envelope.payload().isNull()) {
            throw new InvalidEventException("Event " + envelope.eventId() + " has no payload");
        }
        if (!expectedType.equals(envelope.eventType())) {
            throw new InvalidEventException(
                    "Expected eventType " + expectedType + " but received " + envelope.eventType());
        }
        String correlationId = envelope.correlationId();
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = message.getMessageProperties().getCorrelationId();
        }
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = envelope.eventId().toString();
        }
        Instant occurredAt = (envelope.occurredAt() != null) ? envelope.occurredAt() : Instant.now();
        return new EventEnvelope(envelope.eventId(), envelope.eventType(), correlationId, occurredAt,
                envelope.payload());
    }

    public <T> T readPayload(EventEnvelope envelope, Class<T> type) {
        T payload;
        try {
            payload = this.objectMapper.treeToValue(envelope.payload(), type);
        }
        catch (JsonProcessingException | IllegalArgumentException ex) {
            throw new InvalidEventException("Payload of " + envelope.eventType() + " is invalid: " + ex.getMessage());
        }
        Set<ConstraintViolation<T>> violations = this.validator.validate(payload);
        if (!violations.isEmpty()) {
            String details = violations.stream()
                .map((violation) -> violation.getPropertyPath() + " " + violation.getMessage())
                .sorted()
                .collect(Collectors.joining(", "));
            throw new InvalidEventException("Payload of " + envelope.eventType() + " is invalid: " + details);
        }
        return payload;
    }

}
