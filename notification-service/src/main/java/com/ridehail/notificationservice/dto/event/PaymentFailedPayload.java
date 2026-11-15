package com.ridehail.notificationservice.dto.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * Payload của event payment.failed
 */
public record PaymentFailedPayload(UUID paymentId, @NotNull UUID tripId, @NotNull UUID riderId, UUID driverId,
        @NotNull BigDecimal amount, String reason, Instant failedAt) {

}
