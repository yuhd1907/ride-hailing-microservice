package com.ridehail.paymentservice.service;

import com.ridehail.paymentservice.dto.event.TripClosedPayload;
import com.ridehail.paymentservice.dto.event.TripRequestedPayload;
import com.ridehail.paymentservice.messaging.EventEnvelope;

/**
 * Bước xác nhận thanh toán của Saga đặt chuyến: khoá tiền khi chuyến được đặt, mở khoá
 * khi chuyến bị hủy hoặc thất bại trước khi hoàn thành.
 */
public interface PaymentAuthorizationService {

    void handleTripRequested(EventEnvelope envelope, TripRequestedPayload payload);

    void handleTripClosed(EventEnvelope envelope, TripClosedPayload payload);

}
