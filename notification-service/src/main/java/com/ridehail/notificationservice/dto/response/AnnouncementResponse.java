package com.ridehail.notificationservice.dto.response;

import java.time.Instant;
import java.util.UUID;

import com.ridehail.notificationservice.entity.Announcement;

public record AnnouncementResponse(UUID announcementId, String audience, String category, String title,
        String content, boolean pinned, Instant publishedAt, Instant expiresAt) {

    public static AnnouncementResponse of(Announcement a) {
        return new AnnouncementResponse(a.getId(), a.getAudience(), a.getCategory(), a.getTitle(), a.getContent(),
                a.isPinned(), a.getPublishedAt(), a.getExpiresAt());
    }

}
