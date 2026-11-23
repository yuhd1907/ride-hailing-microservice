package com.ridehail.paymentservice.dto.event;

import com.ridehail.paymentservice.entity.PaymentMethod;
import com.ridehail.paymentservice.messaging.InvalidEventException;

/**
 * Đọc paymentMethod trong event của Trip. Trip cũ chưa gửi field này thì coi là BANK
 * (thanh toán tự động như trước); giá trị lạ làm event vào DLQ.
 */
final class PaymentMethods {

    private PaymentMethods() {
    }

    static PaymentMethod resolve(String value) {
        if (value == null || value.isBlank()) {
            return PaymentMethod.BANK;
        }
        try {
            return PaymentMethod.valueOf(value);
        }
        catch (IllegalArgumentException ex) {
            throw new InvalidEventException("Unsupported paymentMethod: " + value);
        }
    }

}
