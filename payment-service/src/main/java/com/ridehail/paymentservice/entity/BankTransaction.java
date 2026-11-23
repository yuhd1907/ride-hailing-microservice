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

/**
 * Một dòng lịch sử của tài khoản ngân hàng ảo, kèm số dư và số dư khả dụng sau giao dịch.
 */
@Entity
@Table(name = "bank_transactions")
public class BankTransaction {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", length = 10, nullable = false, updatable = false)
    private BankTransactionType type;

    @Column(name = "amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "trip_id", updatable = false)
    private UUID tripId;

    @Column(name = "balance_after", nullable = false, updatable = false, precision = 14, scale = 2)
    private BigDecimal balanceAfter;

    @Column(name = "available_after", nullable = false, updatable = false, precision = 14, scale = 2)
    private BigDecimal availableAfter;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    protected BankTransaction() {
    }

    public BankTransaction(UUID userId, BankTransactionType type, BigDecimal amount, UUID tripId,
            BigDecimal balanceAfter, BigDecimal availableAfter) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.type = type;
        this.amount = amount;
        this.tripId = tripId;
        this.balanceAfter = balanceAfter;
        this.availableAfter = availableAfter;
    }

    public UUID getId() {
        return this.id;
    }

    public UUID getUserId() {
        return this.userId;
    }

    public BankTransactionType getType() {
        return this.type;
    }

    public BigDecimal getAmount() {
        return this.amount;
    }

    public UUID getTripId() {
        return this.tripId;
    }

    public BigDecimal getBalanceAfter() {
        return this.balanceAfter;
    }

    public BigDecimal getAvailableAfter() {
        return this.availableAfter;
    }

    public Instant getCreatedAt() {
        return this.createdAt;
    }

}
