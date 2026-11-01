package com.ridehail.notificationservice.entity;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

/**
 * Hibernate Entity đại diện cho bảng notifications trong PostgreSQL
 */
@Entity
@Table(name = "notifications")
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "recipient_id", nullable = false)
    private UUID recipientId;

    @Enumerated(EnumType.STRING)
    @Column(name = "recipient_role", length = 20)
    private RecipientRole recipientRole;

    // Chuỗi tự do (DRIVER_ASSIGNED, PAYMENT_SUCCEEDED, ...) để thêm loại mới không cần
    // migration
    @Column(name = "type", length = 50, nullable = false)
    private String type;

    @Enumerated(EnumType.STRING)
    @Column(name = "channel", length = 20, nullable = false)
    private NotificationChannel channel;

    @Column(name = "content", nullable = false, columnDefinition = "text")
    private String content;

    @Column(name = "event_id")
    private UUID eventId;

    @Column(name = "trip_id")
    private UUID tripId;

    @Column(name = "correlation_id", length = 128)
    private String correlationId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    protected Notification() {
    }

    public Notification(UUID recipientId, RecipientRole recipientRole, String type, NotificationChannel channel,
            String content, UUID eventId, UUID tripId, String correlationId) {
        this.recipientId = recipientId;
        this.recipientRole = recipientRole;
        this.type = type;
        this.channel = channel;
        this.content = content;
        this.eventId = eventId;
        this.tripId = tripId;
        this.correlationId = correlationId;
    }

    public UUID getId() {
        return this.id;
    }

    public UUID getRecipientId() {
        return this.recipientId;
    }

    public RecipientRole getRecipientRole() {
        return this.recipientRole;
    }

    public String getType() {
        return this.type;
    }

    public NotificationChannel getChannel() {
        return this.channel;
    }

    public String getContent() {
        return this.content;
    }

    public UUID getEventId() {
        return this.eventId;
    }

    public UUID getTripId() {
        return this.tripId;
    }

    public String getCorrelationId() {
        return this.correlationId;
    }

    public Instant getCreatedAt() {
        return this.createdAt;
    }

}
