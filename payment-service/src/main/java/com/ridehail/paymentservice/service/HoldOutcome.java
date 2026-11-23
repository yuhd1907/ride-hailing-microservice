package com.ridehail.paymentservice.service;

import com.ridehail.paymentservice.entity.FundHold;

/**
 * Kết quả tạm khoá tiền cho một chuyến. {@code hold} là null khi không đủ tiền.
 */
public record HoldOutcome(Decision decision, FundHold hold) {

    public enum Decision {

        HELD, ALREADY_HELD, INSUFFICIENT_FUNDS

    }

}
