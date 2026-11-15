package com.ridehail.paymentservice.entity;

/**
 * Lý do thanh toán thất bại, gửi kèm event payment.failed
 */
public enum PaymentFailureReason {

    INSUFFICIENT_FUNDS, PAYMENT_DECLINED, INTERNAL_ERROR

}
