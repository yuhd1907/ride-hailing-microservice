package com.rideflow.notification.notification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "notifications", indexes = @Index(name = "idx_notifications_recipient_id", columnList = "recipient_id"))
public class Notification {

	@Id
	@GeneratedValue(strategy = GenerationType.UUID)
	private UUID id;

	@Column(name = "recipient_id", nullable = false)
	private UUID recipientId;

	// Free-form on purpose (DRIVER_ASSIGNED, PAYMENT_SUCCESS, ...) so new types don't need a migration
	@Column(nullable = false, length = 50)
	private String type;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 20)
	private NotificationChannel channel;

	@Column(nullable = false, columnDefinition = "text")
	private String content;

	@CreationTimestamp
	@Column(name = "created_at", nullable = false, updatable = false)
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
		return id;
	}

	public UUID getRecipientId() {
		return recipientId;
	}

	public String getType() {
		return type;
	}

	public NotificationChannel getChannel() {
		return channel;
	}

	public String getContent() {
		return content;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}
}
