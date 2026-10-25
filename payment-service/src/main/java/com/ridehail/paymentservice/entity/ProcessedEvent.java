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
 * Mỗi event đã xử lý ghi một dòng, dùng để bỏ qua message bị gửi lại (deduplication).
 * <p>
 * Implements {@link Persistable} với {@code isNew() == true} để {@code save()} luôn chạy
 * INSERT: event bị gửi lại sẽ lỗi khóa chính thay vì bị merge âm thầm.
 */
@Entity
@Table(name = "processed_events")
public class ProcessedEvent implements Persistable<UUID> {

    @Id
    @Column(name = "event_id", nullable = false, updatable = false)
    private UUID eventId;

    @Column(name = "event_type", length = 100, nullable = false)
    private String eventType;

    @Column(name = "processed_at", nullable = false, columnDefinition = "timestamptz")
    private Instant processedAt;

    @Transient
    private boolean isNew = true;

    protected ProcessedEvent() {
        this.isNew = false;
    }

    public ProcessedEvent(UUID eventId, String eventType) {
        this.eventId = eventId;
        this.eventType = eventType;
        this.processedAt = Instant.now();
    }

    @Override
    public UUID getId() {
        return this.eventId;
    }

    @Override
    public boolean isNew() {
        return this.isNew;
    }

    public String getEventType() {
        return this.eventType;
    }

    public Instant getProcessedAt() {
        return this.processedAt;
    }

}
