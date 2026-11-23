package com.ridehail.paymentservice.dto.response;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.ridehail.paymentservice.entity.BankTransactionType;

public record BankTransactionResponse(UUID id, BankTransactionType type, BigDecimal amount, UUID tripId,
        BigDecimal balanceAfter, BigDecimal availableAfter, Instant createdAt) {
}
