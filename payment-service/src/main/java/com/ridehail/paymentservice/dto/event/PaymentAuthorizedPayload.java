package com.ridehail.paymentservice.dto.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.ridehail.paymentservice.entity.PaymentMethod;

/**
 * Đã xác nhận thanh toán cho chuyến: BANK thì tiền đã được khoá (holdId), CASH thì không
 * cần khoá. Trip nhận event này mới cho Matching ghép tài xế.
 */
public record PaymentAuthorizedPayload(UUID tripId, UUID riderId, BigDecimal amount, PaymentMethod paymentMethod,
        UUID holdId, Instant authorizedAt) {
}
