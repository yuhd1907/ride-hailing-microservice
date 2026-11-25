package com.ridehail.paymentservice.dto.response;

import java.math.BigDecimal;

/**
 * Chính sách ví tài xế hiển thị trên web: tỷ lệ chiết khấu nền tảng và giới hạn rút tiền.
 */
public record WalletPolicyResponse(BigDecimal commissionRate, BigDecimal minWithdraw, BigDecimal maxWithdraw) {
}
