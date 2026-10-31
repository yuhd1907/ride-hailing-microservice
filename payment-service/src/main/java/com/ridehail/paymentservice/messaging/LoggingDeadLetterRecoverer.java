package com.ridehail.paymentservice.messaging;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.retry.RejectAndDontRequeueRecoverer;
import org.springframework.core.NestedExceptionUtils;

/**
 * Chạy khi hết số lần retry (hoặc message không hợp lệ): ghi log rồi reject không
 * requeue, để RabbitMQ chuyển message sang dead-letter queue qua exchange rideflow.dlx.
 */
public class LoggingDeadLetterRecoverer extends RejectAndDontRequeueRecoverer {

    private static final Logger log = LoggerFactory.getLogger(LoggingDeadLetterRecoverer.class);

    @Override
    public void recover(Message message, Throwable cause) {
        MessageProperties properties = message.getMessageProperties();
        Throwable root = NestedExceptionUtils.getMostSpecificCause(cause);
        log.error("Chuyển message sang DLQ: queue={}, messageId={}, correlationId={}, lý do={}",
                properties.getConsumerQueue(), properties.getMessageId(), properties.getCorrelationId(),
                root.getMessage());
        super.recover(message, cause);
    }

}
