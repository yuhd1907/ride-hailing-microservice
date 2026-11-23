package com.ridehail.paymentservice.dto.response;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Số dư tài khoản ngân hàng ảo: available = balance - held.
 */
public record BankAccountResponse(UUID userId, BigDecimal balance, BigDecimal held, BigDecimal available) {
}
