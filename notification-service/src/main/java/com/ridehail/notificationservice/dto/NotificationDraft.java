package com.ridehail.notificationservice.dto;

import java.util.UUID;

import com.ridehail.notificationservice.entity.RecipientRole;

/**
 * Nội dung một thông báo cần gửi, trước khi được lưu thành Notification
 */
public record NotificationDraft(UUID recipientId, RecipientRole recipientRole, String type, String content) {

}
