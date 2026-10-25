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

    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 20, nullable = false)
    private PaymentStatus status;

    // Cùng một key đến hai lần không được tạo thêm payment thứ hai
    @Column(name = "idempotency_key", nullable = false, unique = true)
    private UUID idempotencyKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz")
    private Instant updatedAt;

    protected Payment() {
    }

    public Payment(UUID tripId, UUID riderId, BigDecimal amount, UUID idempotencyKey) {
        this.tripId = tripId;
        this.riderId = riderId;
        this.amount = amount;
        this.idempotencyKey = idempotencyKey;
        this.status = PaymentStatus.PENDING;
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

    public BigDecimal getAmount() {
        return this.amount;
    }

    public PaymentStatus getStatus() {
        return this.status;
    }

    public void setStatus(PaymentStatus status) {
        this.status = status;
    }

    public UUID getIdempotencyKey() {
        return this.idempotencyKey;
    }

    public Instant getCreatedAt() {
        return this.createdAt;
    }

    public Instant getUpdatedAt() {
        return this.updatedAt;
    }

}
