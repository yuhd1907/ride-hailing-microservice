package com.ridehail.paymentservice.dto.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.ridehail.paymentservice.entity.PaymentFailureReason;

/**
 * Payload của event payment.failed. Trip Service nhận event này để chạy bước bù trừ của
 * Saga.
 */
public record PaymentFailedPayload(UUID paymentId, UUID tripId, UUID riderId, UUID driverId, BigDecimal amount,
        PaymentFailureReason reason, Instant failedAt) {

}
