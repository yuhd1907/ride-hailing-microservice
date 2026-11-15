package com.ridehail.notificationservice.messaging;

import org.springframework.amqp.AmqpRejectAndDontRequeueException;

/**
 * Message sai định dạng hoặc thiếu dữ liệu. Thử lại không có tác dụng nên message được
 * chuyển thẳng sang dead-letter queue, không qua retry.
 */
public class InvalidEventException extends AmqpRejectAndDontRequeueException {

    public InvalidEventException(String message) {
        super(message);
    }

}
