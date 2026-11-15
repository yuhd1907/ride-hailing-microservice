package com.ridehail.paymentservice.simulation;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.entity.PaymentFailureReason;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Cổng thanh toán giả lập. Quy tắc cố định để demo lặp lại được: số tiền vượt hạn mức
 * {@code payment.simulation.max-amount} thì thất bại với lý do INSUFFICIENT_FUNDS.
 */
@Component
public class PaymentGatewaySimulator {

    private final BigDecimal maxAmount;

    public PaymentGatewaySimulator(@Value("${payment.simulation.max-amount:2000000}") BigDecimal maxAmount) {
        this.maxAmount = maxAmount;
    }

    public Optional<PaymentFailureReason> charge(UUID riderId, BigDecimal amount) {
        if (amount.compareTo(this.maxAmount) > 0) {
            return Optional.of(PaymentFailureReason.INSUFFICIENT_FUNDS);
        }
        return Optional.empty();
    }

    public BigDecimal getMaxAmount() {
        return this.maxAmount;
    }

}
