package com.ridehail.paymentservice.dto.request;

import java.math.BigDecimal;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

/**
 * Nạp tiền vào ngân hàng ảo để demo: 1.000 - 5.000.000 VND mỗi lần.
 */
public record TopUpRequest(@NotNull(message = "Số tiền không được để trống") @DecimalMin(value = "1000",
        message = "Số tiền nạp tối thiểu 1.000 VND") @DecimalMax(value = "5000000",
                message = "Số tiền nạp tối đa 5.000.000 VND") BigDecimal amount) {
}
