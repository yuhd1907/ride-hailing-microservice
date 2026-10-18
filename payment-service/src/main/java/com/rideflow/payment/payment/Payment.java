package com.rideflow.payment.payment;

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
import org.hibernate.annotations.UpdateTimestamp;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "payments", indexes = @Index(name = "idx_payments_trip_id", columnList = "trip_id"))
public class Payment {

	@Id
	@GeneratedValue(strategy = GenerationType.UUID)
	private UUID id;

	@Column(name = "trip_id", nullable = false)
	private UUID tripId;

	@Column(name = "rider_id", nullable = false)
	private UUID riderId;

	@Column(nullable = false, precision = 12, scale = 2)
	private BigDecimal amount;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 20)
	private PaymentStatus status;

	// Same key arriving twice must not create a second payment
	@Column(name = "idempotency_key", nullable = false, unique = true)
	private String idempotencyKey;

	@CreationTimestamp
	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@UpdateTimestamp
	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	protected Payment() {
	}

	public Payment(UUID tripId, UUID riderId, BigDecimal amount, String idempotencyKey) {
		this.tripId = tripId;
		this.riderId = riderId;
		this.amount = amount;
		this.idempotencyKey = idempotencyKey;
		this.status = PaymentStatus.PENDING;
	}

	public UUID getId() {
		return id;
	}

	public UUID getTripId() {
		return tripId;
	}

	public UUID getRiderId() {
		return riderId;
	}

	public BigDecimal getAmount() {
		return amount;
	}

	public PaymentStatus getStatus() {
		return status;
	}

	public void setStatus(PaymentStatus status) {
		this.status = status;
	}

	public String getIdempotencyKey() {
		return idempotencyKey;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}
}
