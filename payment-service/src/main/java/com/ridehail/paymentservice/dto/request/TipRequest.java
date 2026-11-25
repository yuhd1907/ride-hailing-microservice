package com.ridehail.paymentservice.dto.request;

import java.math.BigDecimal;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

/**
 * Khách tip cho tài xế sau chuyến: 5.000 - 500.000 VND.
 */
public record TipRequest(@NotNull(message = "Số tiền không được để trống") @DecimalMin(value = "5000",
        message = "Tip tối thiểu 5.000 VND") @DecimalMax(value = "500000",
                message = "Tip tối đa 500.000 VND") BigDecimal amount) {
}
