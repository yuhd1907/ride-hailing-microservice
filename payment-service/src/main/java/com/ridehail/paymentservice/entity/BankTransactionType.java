package com.ridehail.paymentservice.entity;

/**
 * Loại giao dịch trong ngân hàng ảo (ADJUST: script kiểm thử đặt số dư).
 */
public enum BankTransactionType {

    TOPUP, HOLD, RELEASE, CAPTURE, ADJUST

}
