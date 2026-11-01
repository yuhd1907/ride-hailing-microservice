package com.ridehail.paymentservice.mapper;

import com.ridehail.paymentservice.dto.response.PaymentResponse;
import com.ridehail.paymentservice.entity.Payment;

/**
 * Chuyển entity Payment sang response trả cho client
 */
public final class PaymentMapper {

    private PaymentMapper() {
    }

    public static PaymentResponse toResponse(Payment payment) {
        return new PaymentResponse(payment.getId(), payment.getTripId(), payment.getRiderId(), payment.getDriverId(),
                payment.getAmount(), payment.getStatus(), payment.getFailureReason(), payment.getCorrelationId(),
                payment.getCreatedAt(), payment.getUpdatedAt());
    }

}
