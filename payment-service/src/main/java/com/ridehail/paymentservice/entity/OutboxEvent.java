package com.ridehail.paymentservice.entity;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

/**
 * Event chờ publish lên RabbitMQ (Outbox pattern). Được ghi cùng transaction với dữ liệu
 * nghiệp vụ nên event không bị mất khi RabbitMQ tạm thời không truy cập được.
 */
@Entity
@Table(name = "outbox_events")
public class OutboxEvent implements Persistable<UUID> {

    private static final int MAX_ERROR_LENGTH = 1000;

    @Id
    @Column(name = "event_id", nullable = false, updatable = false)
    private UUID eventId;

    @Column(name = "event_type", length = 100, nullable = false)
    private String eventType;

    @Column(name = "aggregate_id", nullable = false)
    private UUID aggregateId;

    @Column(name = "correlation_id", length = 128, nullable = false)
    private String correlationId;

    @Column(name = "body", nullable = false, columnDefinition = "text")
    private String body;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "last_error", columnDefinition = "text")
    private String lastError;

    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    @Column(name = "published_at", columnDefinition = "timestamptz")
    private Instant publishedAt;

    @Transient
    private boolean isNew = true;

    protected OutboxEvent() {
        this.isNew = false;
    }

    public OutboxEvent(UUID eventId, String eventType, UUID aggregateId, String correlationId, String body) {
        this.eventId = eventId;
        this.eventType = eventType;
        this.aggregateId = aggregateId;
        this.correlationId = correlationId;
        this.body = body;
        this.createdAt = Instant.now();
    }

    public void markPublished() {
        this.publishedAt = Instant.now();
        this.lastError = null;
    }

    public void markFailed(String error) {
        this.attempts++;
        String message = (error != null) ? error : "unknown error";
        this.lastError = (message.length() > MAX_ERROR_LENGTH) ? message.substring(0, MAX_ERROR_LENGTH) : message;
    }

    @Override
    public UUID getId() {
        return this.eventId;
    }

    @Override
    public boolean isNew() {
        return this.isNew;
    }

    public UUID getEventId() {
        return this.eventId;
    }

    public String getEventType() {
        return this.eventType;
    }

    public UUID getAggregateId() {
        return this.aggregateId;
    }

    public String getCorrelationId() {
        return this.correlationId;
    }

    public String getBody() {
        return this.body;
    }

    public int getAttempts() {
        return this.attempts;
    }

    public String getLastError() {
        return this.lastError;
    }

    public Instant getCreatedAt() {
        return this.createdAt;
    }

    public Instant getPublishedAt() {
        return this.publishedAt;
    }

}
