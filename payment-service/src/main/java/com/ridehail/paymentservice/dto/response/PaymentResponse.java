package com.ridehail.paymentservice.dto.response;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.ridehail.paymentservice.entity.PaymentFailureReason;
import com.ridehail.paymentservice.entity.PaymentMethod;
import com.ridehail.paymentservice.entity.PaymentStatus;

public record PaymentResponse(UUID paymentId, UUID tripId, UUID riderId, UUID driverId, BigDecimal amount,
        PaymentMethod method, PaymentStatus status, PaymentFailureReason failureReason, String correlationId,
        Instant createdAt, Instant updatedAt) {

}
