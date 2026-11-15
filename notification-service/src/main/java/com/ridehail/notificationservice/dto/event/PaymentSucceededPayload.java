package com.ridehail.notificationservice.dto.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * Payload của event payment.succeeded
 */
public record PaymentSucceededPayload(UUID paymentId, @NotNull UUID tripId, @NotNull UUID riderId, UUID driverId,
        @NotNull BigDecimal amount, Instant paidAt) {

}
