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

    // Chuỗi tự do (DRIVER_ASSIGNED, PAYMENT_SUCCESS, ...) để thêm loại mới không cần
    // migration
    @Column(name = "type", length = 50, nullable = false)
    private String type;

    @Enumerated(EnumType.STRING)
    @Column(name = "channel", length = 20, nullable = false)
    private NotificationChannel channel;

    @Column(name = "content", nullable = false, columnDefinition = "text")
    private String content;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    protected Notification() {
    }

    public Notification(UUID recipientId, String type, NotificationChannel channel, String content) {
        this.recipientId = recipientId;
        this.type = type;
        this.channel = channel;
        this.content = content;
    }

    public UUID getId() {
        return this.id;
    }

    public UUID getRecipientId() {
        return this.recipientId;
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

    public Instant getCreatedAt() {
        return this.createdAt;
    }

}
