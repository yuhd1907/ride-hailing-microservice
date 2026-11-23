package com.ridehail.paymentservice.dto.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.ridehail.paymentservice.entity.PaymentFailureReason;

/**
 * Không khoá được tiền khi đặt chuyến (số dư không đủ). Trip chuyển chuyến sang FAILED.
 */
public record PaymentAuthorizationFailedPayload(UUID tripId, UUID riderId, BigDecimal amount,
        PaymentFailureReason reason, Instant failedAt) {
}
