package com.ridehail.notificationservice.service;

import com.ridehail.notificationservice.entity.Notification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Kênh gửi thông báo mô phỏng (LOG): ghi thông báo ra log của service. Có thể thay bằng
 * WebSocket/push mà không đổi phần xử lý event.
 */
@Component
public class NotificationSender {

    private static final Logger log = LoggerFactory.getLogger(NotificationSender.class);

    public void send(Notification notification) {
        log.info("[NOTIFY] gửi tới {} {} ({}): {}", notification.getRecipientRole(), notification.getRecipientId(),
                notification.getType(), notification.getContent());
    }

}
