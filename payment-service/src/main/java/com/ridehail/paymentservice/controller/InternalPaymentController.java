package com.ridehail.paymentservice.controller;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.math.BigDecimal;
import java.util.UUID;

import com.ridehail.paymentservice.config.RabbitConfig;
import com.ridehail.paymentservice.dto.response.BankAccountResponse;
import com.ridehail.paymentservice.dto.response.PaymentResponse;
import com.ridehail.paymentservice.messaging.DeadLetterQueueManager;
import com.ridehail.paymentservice.repository.OutboxEventRepository;
import com.ridehail.paymentservice.service.BankService;
import com.ridehail.paymentservice.service.PaymentService;
import com.ridehail.paymentservice.simulation.FaultInjector;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * API nội bộ phục vụ kiểm thử và vận hành: tra cứu payment theo chuyến, bật lỗi giả lập,
 * xem và xử lý lại dead-letter queue, xem outbox. Gateway chặn tiền tố /internal từ bên
 * ngoài, nên chỉ gọi trực tiếp vào cổng của service (8085).
 */
@RestController
@RequestMapping("/internal/payments")
public class InternalPaymentController {

    private static final int MAX_REPLAY = 1000;

    private final PaymentService paymentService;

    private final FaultInjector faultInjector;

    private final DeadLetterQueueManager deadLetterQueueManager;

    private final OutboxEventRepository outboxEventRepository;

    private final BankService bankService;

    public InternalPaymentController(PaymentService paymentService, FaultInjector faultInjector,
            DeadLetterQueueManager deadLetterQueueManager, OutboxEventRepository outboxEventRepository,
            BankService bankService) {
        this.paymentService = paymentService;
        this.faultInjector = faultInjector;
        this.deadLetterQueueManager = deadLetterQueueManager;
        this.outboxEventRepository = outboxEventRepository;
        this.bankService = bankService;
    }

    @GetMapping
    public ResponseEntity<List<PaymentResponse>> paymentsOfTrip(@RequestParam UUID tripId) {
        return ResponseEntity.ok(this.paymentService.findPaymentsOfTrip(tripId));
    }

    @GetMapping("/faults")
    public ResponseEntity<Map<String, Object>> faults() {
        return ResponseEntity.ok(faultStatus());
    }

    @PostMapping("/faults")
    public ResponseEntity<Map<String, Object>> injectFaults(@RequestParam int failNext) {
        if (failNext < 0) {
            throw new IllegalArgumentException("failNext phải >= 0");
        }
        this.faultInjector.failNext(failNext);
        return ResponseEntity.ok(faultStatus());
    }

    @DeleteMapping("/faults")
    public ResponseEntity<Map<String, Object>> resetFaults() {
        this.faultInjector.reset();
        return ResponseEntity.ok(faultStatus());
    }

    @GetMapping("/dlq")
    public ResponseEntity<Map<String, Object>> deadLetterQueue() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("queue", RabbitConfig.TRIP_COMPLETED_DLQ);
        body.put("messages", this.deadLetterQueueManager.countMessages(RabbitConfig.TRIP_COMPLETED_DLQ));
        return ResponseEntity.ok(body);
    }

    @PostMapping("/dlq/replay")
    public ResponseEntity<Map<String, Object>> replayDeadLetters(@RequestParam(defaultValue = "100") int max) {
        int limit = Math.max(1, Math.min(max, MAX_REPLAY));
        int moved = this.deadLetterQueueManager.replay(RabbitConfig.TRIP_COMPLETED_DLQ,
                RabbitConfig.TRIP_COMPLETED_QUEUE, limit);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("from", RabbitConfig.TRIP_COMPLETED_DLQ);
        body.put("to", RabbitConfig.TRIP_COMPLETED_QUEUE);
        body.put("replayed", moved);
        return ResponseEntity.ok(body);
    }

    @DeleteMapping("/dlq")
    public ResponseEntity<Map<String, Object>> purgeDeadLetters() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("queue", RabbitConfig.TRIP_COMPLETED_DLQ);
        body.put("purged", this.deadLetterQueueManager.purge(RabbitConfig.TRIP_COMPLETED_DLQ));
        return ResponseEntity.ok(body);
    }

    @GetMapping("/outbox")
    public ResponseEntity<Map<String, Object>> outbox() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("pending", this.outboxEventRepository.countByPublishedAtIsNull());
        body.put("total", this.outboxEventRepository.count());
        return ResponseEntity.ok(body);
    }

    /**
     * Đặt số dư ngân hàng ảo về giá trị cố định, cho script kiểm thử chạy lại nhiều lần
     * vẫn cùng kết quả. Chỉ gọi trực tiếp cổng 8085 (Gateway chặn /internal).
     */
    @PutMapping("/bank/accounts/{userId}/balance")
    public ResponseEntity<BankAccountResponse> setBalance(@PathVariable UUID userId, @RequestParam BigDecimal amount) {
        return ResponseEntity.ok(this.bankService.setBalance(userId, amount));
    }

    private Map<String, Object> faultStatus() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("remainingFailures", this.faultInjector.remaining());
        return body;
    }

}
