package com.ridehail.paymentservice.messaging;

import com.rabbitmq.client.GetResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.QueueInformation;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

/**
 * Xem, xử lý lại (replay) và xóa message trong dead-letter queue.
 */
@Component
public class DeadLetterQueueManager {

    private static final Logger log = LoggerFactory.getLogger(DeadLetterQueueManager.class);

    private static final long CONFIRM_TIMEOUT_MS = 5000;

    private final RabbitTemplate rabbitTemplate;

    private final AmqpAdmin amqpAdmin;

    public DeadLetterQueueManager(RabbitTemplate rabbitTemplate, AmqpAdmin amqpAdmin) {
        this.rabbitTemplate = rabbitTemplate;
        this.amqpAdmin = amqpAdmin;
    }

    public long countMessages(String queue) {
        QueueInformation information = this.amqpAdmin.getQueueInfo(queue);
        return (information != null) ? information.getMessageCount() : 0;
    }

    /**
     * Chuyển tối đa {@code max} message từ DLQ về queue chính. Message chỉ bị xóa khỏi
     * DLQ sau khi broker xác nhận đã nhận bản sao ở queue chính.
     */
    public int replay(String deadLetterQueue, String targetQueue, int max) {
        Integer moved = this.rabbitTemplate.execute((channel) -> {
            channel.confirmSelect();
            int count = 0;
            while (count < max) {
                GetResponse response = channel.basicGet(deadLetterQueue, false);
                if (response == null) {
                    break;
                }
                channel.basicPublish("", targetQueue, response.getProps(), response.getBody());
                channel.waitForConfirmsOrDie(CONFIRM_TIMEOUT_MS);
                channel.basicAck(response.getEnvelope().getDeliveryTag(), false);
                count++;
            }
            return count;
        });
        int result = (moved != null) ? moved : 0;
        log.info("Replay {} message từ {} về {}", result, deadLetterQueue, targetQueue);
        return result;
    }

    public int purge(String queue) {
        int purged = this.amqpAdmin.purgeQueue(queue);
        log.info("Đã xóa {} message trong {}", purged, queue);
        return purged;
    }

}
