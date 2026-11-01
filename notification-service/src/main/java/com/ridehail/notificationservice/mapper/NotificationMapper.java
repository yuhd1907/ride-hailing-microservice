package com.ridehail.notificationservice.mapper;

import com.ridehail.notificationservice.dto.response.NotificationResponse;
import com.ridehail.notificationservice.entity.Notification;

/**
 * Chuyển entity Notification sang response trả cho client
 */
public final class NotificationMapper {

    private NotificationMapper() {
    }

    public static NotificationResponse toResponse(Notification notification) {
        return new NotificationResponse(notification.getId(), notification.getRecipientId(),
                notification.getRecipientRole(), notification.getType(), notification.getChannel(),
                notification.getContent(), notification.getTripId(), notification.getEventId(),
                notification.getCorrelationId(), notification.getCreatedAt());
    }

}
