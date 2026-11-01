package com.ridehail.notificationservice.controller;

import java.util.List;
import java.util.UUID;

import com.ridehail.notificationservice.config.exception.UnauthorizedException;
import com.ridehail.notificationservice.dto.response.NotificationResponse;
import com.ridehail.notificationservice.service.NotificationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Hộp thư thông báo của người dùng đang đăng nhập. Gọi qua Gateway: Gateway kiểm tra JWT
 * và gắn header X-User-Id.
 */
@RestController
@RequestMapping("/notifications")
public class NotificationController {

    private static final String USER_ID_HEADER = "X-User-Id";

    private static final int MAX_LIMIT = 100;

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping("/me")
    public ResponseEntity<List<NotificationResponse>> myNotifications(
            @RequestHeader(value = USER_ID_HEADER, required = false) UUID userId,
            @RequestParam(defaultValue = "20") int limit) {
        if (userId == null) {
            throw new UnauthorizedException("Thiếu danh tính người dùng, hãy gọi qua Gateway kèm Bearer token");
        }
        int pageSize = Math.max(1, Math.min(limit, MAX_LIMIT));
        return ResponseEntity.ok(this.notificationService.getNotificationsOf(userId, pageSize));
    }

}
