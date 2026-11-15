package com.ridehail.paymentservice.service;

import java.util.List;
import java.util.UUID;

import com.ridehail.paymentservice.dto.event.TripCompletedPayload;
import com.ridehail.paymentservice.dto.response.PaymentResponse;
import com.ridehail.paymentservice.messaging.EventEnvelope;

public interface PaymentService {

    /**
     * Bước thanh toán của Saga: thu tiền cho chuyến đã hoàn thành, chống xử lý trùng theo
     * eventId và tripId, rồi ghi event kết quả (payment.succeeded/payment.failed) vào
     * outbox.
     */
    void handleTripCompleted(EventEnvelope envelope, TripCompletedPayload payload);

    PaymentResponse getPayment(UUID paymentId, UUID requesterId);

    PaymentResponse getPaymentOfTrip(UUID tripId, UUID requesterId);

    List<PaymentResponse> getPaymentsOfRider(UUID riderId, int limit);

    List<PaymentResponse> findPaymentsOfTrip(UUID tripId);

}
