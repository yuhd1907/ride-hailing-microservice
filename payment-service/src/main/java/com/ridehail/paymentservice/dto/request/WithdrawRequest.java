package com.ridehail.paymentservice.dto.request;

import java.math.BigDecimal;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

/**
 * Tài xế rút tiền từ ví về tài khoản ngân hàng liên kết: 50.000 - 20.000.000 VND mỗi lần.
 */
public record WithdrawRequest(@NotNull(message = "Số tiền không được để trống") @DecimalMin(value = "50000",
        message = "Số tiền rút tối thiểu 50.000 VND") @DecimalMax(value = "20000000",
                message = "Số tiền rút tối đa 20.000.000 VND") BigDecimal amount) {
}
