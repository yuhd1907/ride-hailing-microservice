package com.ridehail.paymentservice.entity;

/**
 * Loại giao dịch trong ngân hàng ảo (ADJUST_UP/ADJUST_DOWN: script kiểm thử đặt số dư,
 * tăng hoặc giảm).
 * <ul>
 * <li>EARNING: tài xế nhận tiền chuyến khách trả bằng tài khoản (đã trừ chiết khấu)</li>
 * <li>COMMISSION: trừ chiết khấu nền tảng của chuyến khách trả tiền mặt</li>
 * <li>WITHDRAW: tài xế rút tiền về tài khoản ngân hàng liên kết</li>
 * <li>TIP_SENT / TIP_RECEIVED: khách tip cho tài xế sau chuyến (không tính chiết khấu)</li>
 * </ul>
 */
public enum BankTransactionType {

    TOPUP, HOLD, RELEASE, CAPTURE, ADJUST_UP, ADJUST_DOWN, EARNING, COMMISSION, WITHDRAW, TIP_SENT, TIP_RECEIVED

}
