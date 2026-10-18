package com.rideflow.payment.event;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

import java.time.Instant;
import java.util.UUID;

/**
 * One row per consumed event, used to skip redelivered messages.
 * <p>
 * Implements {@link Persistable} with {@code isNew() == true} so that {@code save()} always
 * issues an INSERT: a redelivered event then fails on the primary key instead of being
 * silently merged.
 */
@Entity
@Table(name = "processed_events")
public class ProcessedEvent implements Persistable<UUID> {

	@Id
	@Column(name = "event_id")
	private UUID eventId;

	@Column(name = "event_type", nullable = false, length = 100)
	private String eventType;

	@Column(name = "processed_at", nullable = false)
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
		return eventId;
	}

	@Override
	public boolean isNew() {
		return isNew;
	}

	public String getEventType() {
		return eventType;
	}

	public Instant getProcessedAt() {
		return processedAt;
	}
}
