package com.ridehail.notificationservice.controller;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import com.ridehail.notificationservice.config.exception.UnauthorizedException;
import com.ridehail.notificationservice.dto.request.AnnouncementRequest;
import com.ridehail.notificationservice.dto.response.AnnouncementResponse;
import com.ridehail.notificationservice.entity.Announcement;
import com.ridehail.notificationservice.repository.AnnouncementRepository;
import jakarta.validation.Valid;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Hộp thư thông báo chung: người dùng đọc thông báo dành cho mọi người và cho vai trò của
 * mình (qua Gateway). Vận hành đăng thông báo mới qua API nội bộ (Gateway chặn /internal).
 */
@RestController
public class AnnouncementController {

    private static final int MAX_LIMIT = 50;

    private final AnnouncementRepository repository;

    public AnnouncementController(AnnouncementRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/notifications/announcements")
    public ResponseEntity<List<AnnouncementResponse>> announcements(
            @RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @RequestHeader(value = "X-User-Roles", required = false) String roles,
            @RequestParam(defaultValue = "20") int limit) {
        if (userId == null) {
            throw new UnauthorizedException("Thiếu danh tính người dùng, hãy gọi qua Gateway kèm Bearer token");
        }
        List<String> audiences = new ArrayList<>(List.of("ALL"));
        List<String> granted = (roles == null) ? List.of() : Arrays.stream(roles.split(",")).map(String::trim).toList();
        if (granted.contains("ROLE_PASSENGER")) {
            audiences.add("PASSENGER");
        }
        if (granted.contains("ROLE_DRIVER")) {
            audiences.add("DRIVER");
        }
        int pageSize = Math.max(1, Math.min(limit, MAX_LIMIT));
        return ResponseEntity.ok(this.repository.findVisible(audiences, Instant.now(), PageRequest.of(0, pageSize))
            .stream()
            .map(AnnouncementResponse::of)
            .toList());
    }

    @PostMapping("/internal/notifications/announcements")
    public ResponseEntity<AnnouncementResponse> publish(@Valid @RequestBody AnnouncementRequest request) {
        Announcement saved = this.repository.save(new Announcement(request.audience(), request.category(),
                request.title().trim(), request.content().trim(), request.pinned(), Instant.now(), request.expiresAt()));
        return ResponseEntity.status(HttpStatus.CREATED).body(AnnouncementResponse.of(saved));
    }

}
