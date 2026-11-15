package com.ridehail.notificationservice.controller;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.ridehail.notificationservice.config.RabbitConfig;
import com.ridehail.notificationservice.dto.response.NotificationResponse;
import com.ridehail.notificationservice.messaging.DeadLetterQueueManager;
import com.ridehail.notificationservice.service.NotificationService;
import com.ridehail.notificationservice.simulation.FaultInjector;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * API nội bộ phục vụ kiểm thử và vận hành: tra cứu thông báo theo chuyến (cả hành khách
 * và tài xế), bật lỗi giả lập, xem và xử lý lại các dead-letter queue. Gateway chặn tiền
 * tố /internal từ bên ngoài, nên chỉ gọi trực tiếp vào cổng của service (8086).
 */
@RestController
@RequestMapping("/internal/notifications")
public class InternalNotificationController {

    private static final int MAX_REPLAY = 1000;

    private final NotificationService notificationService;

    private final FaultInjector faultInjector;

    private final DeadLetterQueueManager deadLetterQueueManager;

    public InternalNotificationController(NotificationService notificationService, FaultInjector faultInjector,
            DeadLetterQueueManager deadLetterQueueManager) {
        this.notificationService = notificationService;
        this.faultInjector = faultInjector;
        this.deadLetterQueueManager = deadLetterQueueManager;
    }

    @GetMapping
    public ResponseEntity<List<NotificationResponse>> notificationsOfTrip(@RequestParam UUID tripId) {
        return ResponseEntity.ok(this.notificationService.findNotificationsOfTrip(tripId));
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
    public ResponseEntity<Map<String, Object>> deadLetterQueues() {
        Map<String, Object> body = new LinkedHashMap<>();
        for (String queue : RabbitConfig.QUEUES) {
            String deadLetterQueue = RabbitConfig.deadLetterQueueOf(queue);
            body.put(deadLetterQueue, this.deadLetterQueueManager.countMessages(deadLetterQueue));
        }
        return ResponseEntity.ok(body);
    }

    @PostMapping("/dlq/replay")
    public ResponseEntity<Map<String, Object>> replayDeadLetters(@RequestParam(defaultValue = "100") int max) {
        int limit = Math.max(1, Math.min(max, MAX_REPLAY));
        Map<String, Object> body = new LinkedHashMap<>();
        for (String queue : RabbitConfig.QUEUES) {
            String deadLetterQueue = RabbitConfig.deadLetterQueueOf(queue);
            body.put(deadLetterQueue, this.deadLetterQueueManager.replay(deadLetterQueue, queue, limit));
        }
        return ResponseEntity.ok(body);
    }

    @DeleteMapping("/dlq")
    public ResponseEntity<Map<String, Object>> purgeDeadLetters() {
        Map<String, Object> body = new LinkedHashMap<>();
        for (String queue : RabbitConfig.QUEUES) {
            String deadLetterQueue = RabbitConfig.deadLetterQueueOf(queue);
            body.put(deadLetterQueue, this.deadLetterQueueManager.purge(deadLetterQueue));
        }
        return ResponseEntity.ok(body);
    }

    private Map<String, Object> faultStatus() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("remainingFailures", this.faultInjector.remaining());
        return body;
    }

}
