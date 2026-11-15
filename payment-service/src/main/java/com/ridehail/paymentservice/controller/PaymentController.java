package com.ridehail.paymentservice.controller;

import java.util.List;
import java.util.UUID;

import com.ridehail.paymentservice.config.exception.UnauthorizedException;
import com.ridehail.paymentservice.dto.response.PaymentResponse;
import com.ridehail.paymentservice.service.PaymentService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * API cho hành khách xem thanh toán của mình. Gọi qua Gateway: Gateway kiểm tra JWT và
 * gắn header X-User-Id; khách chỉ xem được payment có riderId trùng với mình.
 */
@RestController
@RequestMapping("/payments")
public class PaymentController {

    static final String USER_ID_HEADER = "X-User-Id";

    private static final int MAX_LIMIT = 100;

    private final PaymentService paymentService;

    public PaymentController(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @GetMapping("/me")
    public ResponseEntity<List<PaymentResponse>> myPayments(
            @RequestHeader(value = USER_ID_HEADER, required = false) UUID userId,
            @RequestParam(defaultValue = "20") int limit) {
        int pageSize = Math.max(1, Math.min(limit, MAX_LIMIT));
        return ResponseEntity.ok(this.paymentService.getPaymentsOfRider(requireUser(userId), pageSize));
    }

    @GetMapping("/trips/{tripId}")
    public ResponseEntity<PaymentResponse> paymentOfTrip(@PathVariable UUID tripId,
            @RequestHeader(value = USER_ID_HEADER, required = false) UUID userId) {
        return ResponseEntity.ok(this.paymentService.getPaymentOfTrip(tripId, requireUser(userId)));
    }

    @GetMapping("/{paymentId}")
    public ResponseEntity<PaymentResponse> payment(@PathVariable UUID paymentId,
            @RequestHeader(value = USER_ID_HEADER, required = false) UUID userId) {
        return ResponseEntity.ok(this.paymentService.getPayment(paymentId, requireUser(userId)));
    }

    private UUID requireUser(UUID userId) {
        if (userId == null) {
            throw new UnauthorizedException("Thiếu danh tính người dùng, hãy gọi qua Gateway kèm Bearer token");
        }
        return userId;
    }

}
