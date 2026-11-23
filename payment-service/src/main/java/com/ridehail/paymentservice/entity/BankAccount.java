package com.ridehail.paymentservice.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * Tài khoản ngân hàng ảo của một hành khách. Số dư khả dụng = số dư - tổng khoản đang
 * khoá; dòng tài khoản được khoá (FOR UPDATE) mỗi lần thay đổi để giao dịch đồng thời
 * không vượt số dư.
 */
@Entity
@Table(name = "bank_accounts")
public class BankAccount {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "balance", nullable = false, precision = 14, scale = 2)
    private BigDecimal balance;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz")
    private Instant updatedAt;

    protected BankAccount() {
    }

    public BankAccount(UUID userId, BigDecimal balance) {
        this.userId = userId;
        this.balance = balance;
    }

    public void credit(BigDecimal amount) {
        this.balance = this.balance.add(amount);
    }

    public void debit(BigDecimal amount) {
        this.balance = this.balance.subtract(amount);
    }

    public void changeBalanceTo(BigDecimal value) {
        this.balance = value;
    }

    public UUID getUserId() {
        return this.userId;
    }

    public BigDecimal getBalance() {
        return this.balance;
    }

    public Instant getCreatedAt() {
        return this.createdAt;
    }

    public Instant getUpdatedAt() {
        return this.updatedAt;
    }

}
