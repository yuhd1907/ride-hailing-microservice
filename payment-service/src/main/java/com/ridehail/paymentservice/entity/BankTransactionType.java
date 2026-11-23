package com.ridehail.paymentservice.entity;

/**
 * Loại giao dịch trong ngân hàng ảo (ADJUST_UP/ADJUST_DOWN: script kiểm thử đặt số dư,
 * tăng hoặc giảm).
 */
public enum BankTransactionType {

    TOPUP, HOLD, RELEASE, CAPTURE, ADJUST_UP, ADJUST_DOWN

}
