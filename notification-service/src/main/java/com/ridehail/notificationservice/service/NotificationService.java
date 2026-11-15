package com.ridehail.notificationservice.service;

import java.util.List;
import java.util.UUID;

import com.ridehail.notificationservice.dto.NotificationDraft;
import com.ridehail.notificationservice.dto.response.NotificationResponse;
import com.ridehail.notificationservice.messaging.EventEnvelope;

public interface NotificationService {

    /**
     * Lưu và gửi các thông báo sinh ra từ một event. Event đã xử lý (theo eventId) bị bỏ
     * qua.
     * @return số thông báo đã gửi (0 nếu event trùng)
     */
    int notify(EventEnvelope envelope, UUID tripId, List<NotificationDraft> drafts);

    List<NotificationResponse> getNotificationsOf(UUID recipientId, int limit);

    List<NotificationResponse> findNotificationsOfTrip(UUID tripId);

}
