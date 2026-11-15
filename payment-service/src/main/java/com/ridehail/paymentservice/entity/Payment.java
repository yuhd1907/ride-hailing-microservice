package com.ridehail.paymentservice.entity;

import java.math.BigDecimal;
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
import org.hibernate.annotations.UpdateTimestamp;

/**
 * Hibernate Entity đại diện cho bảng payments trong PostgreSQL
 */
@Entity
@Table(name = "payments")
public class Payment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "trip_id", nullable = false)
    private UUID tripId;

    @Column(name = "rider_id", nullable = false)
    private UUID riderId;

    @Column(name = "driver_id")
    private UUID driverId;

    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 20, nullable = false)
    private PaymentStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "failure_reason", length = 30)
    private PaymentFailureReason failureReason;

    // Cùng một key đến hai lần không được tạo thêm payment thứ hai
    @Column(name = "idempotency_key", nullable = false, unique = true)
    private UUID idempotencyKey;

    @Column(name = "correlation_id", length = 128)
    private String correlationId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz")
    private Instant updatedAt;

    protected Payment() {
    }

    public Payment(UUID tripId, UUID riderId, UUID driverId, BigDecimal amount, UUID idempotencyKey,
            String correlationId) {
        this.tripId = tripId;
        this.riderId = riderId;
        this.driverId = driverId;
        this.amount = amount;
        this.idempotencyKey = idempotencyKey;
        this.correlationId = correlationId;
        this.status = PaymentStatus.PENDING;
    }

    public void markSucceeded() {
        this.status = PaymentStatus.SUCCESS;
        this.failureReason = null;
    }

    public void markFailed(PaymentFailureReason reason) {
        this.status = PaymentStatus.FAILED;
        this.failureReason = reason;
    }

    public UUID getId() {
        return this.id;
    }

    public UUID getTripId() {
        return this.tripId;
    }

    public UUID getRiderId() {
        return this.riderId;
    }

    public UUID getDriverId() {
        return this.driverId;
    }

    public BigDecimal getAmount() {
        return this.amount;
    }

    public PaymentStatus getStatus() {
        return this.status;
    }

    public PaymentFailureReason getFailureReason() {
        return this.failureReason;
    }

    public UUID getIdempotencyKey() {
        return this.idempotencyKey;
    }

    public String getCorrelationId() {
        return this.correlationId;
    }

    public Instant getCreatedAt() {
        return this.createdAt;
    }

    public Instant getUpdatedAt() {
        return this.updatedAt;
    }

}
