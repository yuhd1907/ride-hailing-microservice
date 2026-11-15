package com.ridehail.notificationservice.dto.response;

import java.time.Instant;
import java.util.UUID;

import com.ridehail.notificationservice.entity.NotificationChannel;
import com.ridehail.notificationservice.entity.RecipientRole;

public record NotificationResponse(UUID notificationId, UUID recipientId, RecipientRole recipientRole, String type,
        NotificationChannel channel, String content, UUID tripId, UUID eventId, String correlationId,
        Instant createdAt) {

}
