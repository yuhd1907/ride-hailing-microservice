package com.ridehail.notificationservice.config;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.ridehail.notificationservice.messaging.EventTypes;
import com.ridehail.notificationservice.messaging.InvalidEventException;
import com.ridehail.notificationservice.messaging.LoggingDeadLetterRecoverer;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarable;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.retry.MessageRecoverer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.amqp.RabbitRetryTemplateCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.retry.policy.SimpleRetryPolicy;

/**
 * Khai báo exchange, queue và dead-letter queue của Notification Service: mỗi event đăng
 * ký có một queue {@code notification-service.<eventType>} và một DLQ
 * {@code <queue>.dlq}.
 */
@Configuration
public class RabbitConfig {

    public static final String EVENTS_EXCHANGE = "rideflow.events";

    public static final String DEAD_LETTER_EXCHANGE = "rideflow.dlx";

    public static final String QUEUE_PREFIX = "notification-service.";

    public static final String DLQ_SUFFIX = ".dlq";

    public static final String DRIVER_ASSIGNED_QUEUE = QUEUE_PREFIX + EventTypes.DRIVER_ASSIGNED;

    public static final String PAYMENT_SUCCEEDED_QUEUE = QUEUE_PREFIX + EventTypes.PAYMENT_SUCCEEDED;

    public static final String PAYMENT_FAILED_QUEUE = QUEUE_PREFIX + EventTypes.PAYMENT_FAILED;

    public static final String TRIP_COMPENSATED_QUEUE = QUEUE_PREFIX + EventTypes.TRIP_COMPENSATED;

    public static final String TRIP_FAILED_QUEUE = QUEUE_PREFIX + EventTypes.TRIP_FAILED;

    public static final String TRIP_ACCEPTED_QUEUE = QUEUE_PREFIX + EventTypes.TRIP_ACCEPTED;

    public static final List<String> QUEUES = List.of(DRIVER_ASSIGNED_QUEUE, PAYMENT_SUCCEEDED_QUEUE,
            PAYMENT_FAILED_QUEUE, TRIP_COMPENSATED_QUEUE, TRIP_FAILED_QUEUE, TRIP_ACCEPTED_QUEUE);

    public static String deadLetterQueueOf(String queue) {
        return queue + DLQ_SUFFIX;
    }

    @Bean
    public Declarables notificationTopology() {
        TopicExchange events = ExchangeBuilder.topicExchange(EVENTS_EXCHANGE).durable(true).build();
        DirectExchange deadLetters = ExchangeBuilder.directExchange(DEAD_LETTER_EXCHANGE).durable(true).build();
        List<Declarable> declarables = new ArrayList<>();
        declarables.add(events);
        declarables.add(deadLetters);
        for (String eventType : EventTypes.SUBSCRIBED) {
            String queueName = QUEUE_PREFIX + eventType;
            String deadLetterName = deadLetterQueueOf(queueName);
            Queue queue = QueueBuilder.durable(queueName)
                .deadLetterExchange(DEAD_LETTER_EXCHANGE)
                .deadLetterRoutingKey(deadLetterName)
                .build();
            Queue deadLetterQueue = QueueBuilder.durable(deadLetterName).build();
            declarables.add(queue);
            declarables.add(deadLetterQueue);
            declarables.add(BindingBuilder.bind(queue).to(events).with(eventType));
            declarables.add(BindingBuilder.bind(deadLetterQueue).to(deadLetters).with(deadLetterName));
        }
        return new Declarables(declarables);
    }

    @Bean
    public MessageRecoverer deadLetterRecoverer() {
        return new LoggingDeadLetterRecoverer();
    }

    /**
     * Message sai định dạng không được retry: chuyển thẳng vào DLQ.
     */
    @Bean
    public RabbitRetryTemplateCustomizer listenerRetryPolicy(
            @Value("${spring.rabbitmq.listener.simple.retry.max-attempts:3}") int maxAttempts) {
        return (target, retryTemplate) -> {
            if (target == RabbitRetryTemplateCustomizer.Target.LISTENER) {
                Map<Class<? extends Throwable>, Boolean> retryable = Map.of(InvalidEventException.class, false);
                retryTemplate.setRetryPolicy(new SimpleRetryPolicy(maxAttempts, retryable, true, true));
            }
        };
    }

}
