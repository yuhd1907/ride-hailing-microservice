package com.ridehail.paymentservice.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * Khoản tiền tạm khoá khi đặt chuyến trả bằng ngân hàng. Kết thúc chuyến thì CAPTURED,
 * chuyến hủy/thất bại hoặc quá hạn thì RELEASED. Mỗi chuyến có nhiều nhất một khoản.
 */
@Entity
@Table(name = "fund_holds")
public class FundHold {

    @Id
    @Column(name = "hold_id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "trip_id", nullable = false, updatable = false, unique = true)
    private UUID tripId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 10, nullable = false)
    private HoldStatus status;

    @Column(name = "expires_at", nullable = false, columnDefinition = "timestamptz")
    private Instant expiresAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz")
    private Instant updatedAt;

    protected FundHold() {
    }

    public FundHold(UUID tripId, UUID userId, BigDecimal amount, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.tripId = tripId;
        this.userId = userId;
        this.amount = amount;
        this.expiresAt = expiresAt;
        this.status = HoldStatus.HELD;
    }

    public void capture() {
        this.status = HoldStatus.CAPTURED;
    }

    public void release() {
        this.status = HoldStatus.RELEASED;
    }

    public UUID getId() {
        return this.id;
    }

    public UUID getTripId() {
        return this.tripId;
    }

    public UUID getUserId() {
        return this.userId;
    }

    public BigDecimal getAmount() {
        return this.amount;
    }

    public HoldStatus getStatus() {
        return this.status;
    }

    public Instant getExpiresAt() {
        return this.expiresAt;
    }

    public Instant getCreatedAt() {
        return this.createdAt;
    }

    public Instant getUpdatedAt() {
        return this.updatedAt;
    }

}
