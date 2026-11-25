package com.ridehail.paymentservice.dto.response;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Tip của khách cho chuyến; amount = null nếu chưa tip.
 */
public record TipResponse(UUID tripId, BigDecimal amount, Instant tippedAt) {
}
