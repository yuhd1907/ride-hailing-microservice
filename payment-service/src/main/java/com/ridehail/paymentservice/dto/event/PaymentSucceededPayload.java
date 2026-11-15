package com.ridehail.paymentservice.dto.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Payload của event payment.succeeded
 */
public record PaymentSucceededPayload(UUID paymentId, UUID tripId, UUID riderId, UUID driverId, BigDecimal amount,
        Instant paidAt) {

}
