package com.ridehail.notificationservice.dto.request;

import java.time.Instant;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Đăng thông báo chung (API nội bộ cho vận hành).
 */
public record AnnouncementRequest(
        @NotBlank @Pattern(regexp = "ALL|PASSENGER|DRIVER", message = "audience phải là ALL, PASSENGER hoặc DRIVER") String audience,
        @NotBlank @Pattern(regexp = "POLICY|MAINTENANCE|PROMOTION|NEWS",
                message = "category phải là POLICY, MAINTENANCE, PROMOTION hoặc NEWS") String category,
        @NotBlank @Size(max = 150) String title, @NotBlank @Size(max = 5000) String content, boolean pinned,
        Instant expiresAt) {
}
