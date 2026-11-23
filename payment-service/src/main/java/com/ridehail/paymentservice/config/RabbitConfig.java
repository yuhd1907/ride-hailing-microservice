package com.ridehail.paymentservice.config;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.ridehail.paymentservice.messaging.EventTypes;
import com.ridehail.paymentservice.messaging.InvalidEventException;
import com.ridehail.paymentservice.messaging.LoggingDeadLetterRecoverer;
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
 * Khai báo exchange, queue và dead-letter queue của Payment Service: mỗi event trong
 * {@link EventTypes#SUBSCRIBED} có queue payment-service.&lt;eventType&gt; và DLQ riêng.
 * <p>
 * Luồng lỗi: listener lỗi được retry tại chỗ (cấu hình
 * spring.rabbitmq.listener.simple.retry), hết số lần thử thì
 * {@link LoggingDeadLetterRecoverer} reject message, RabbitMQ chuyển message qua exchange
 * {@value #DEAD_LETTER_EXCHANGE} vào DLQ của queue đó.
 */
@Configuration
public class RabbitConfig {

    public static final String EVENTS_EXCHANGE = "rideflow.events";

    public static final String DEAD_LETTER_EXCHANGE = "rideflow.dlx";

    public static final String QUEUE_PREFIX = "payment-service.";

    public static final String DLQ_SUFFIX = ".dlq";

    public static final String TRIP_COMPLETED_QUEUE = QUEUE_PREFIX + EventTypes.TRIP_COMPLETED;

    public static final String TRIP_COMPLETED_DLQ = TRIP_COMPLETED_QUEUE + DLQ_SUFFIX;

    public static final String TRIP_REQUESTED_QUEUE = QUEUE_PREFIX + EventTypes.TRIP_REQUESTED;

    public static final String TRIP_CANCELLED_QUEUE = QUEUE_PREFIX + EventTypes.TRIP_CANCELLED;

    public static final String TRIP_FAILED_QUEUE = QUEUE_PREFIX + EventTypes.TRIP_FAILED;

    @Bean
    public Declarables paymentTopology() {
        TopicExchange events = ExchangeBuilder.topicExchange(EVENTS_EXCHANGE).durable(true).build();
        DirectExchange deadLetters = ExchangeBuilder.directExchange(DEAD_LETTER_EXCHANGE).durable(true).build();
        List<Declarable> declarables = new ArrayList<>();
        declarables.add(events);
        declarables.add(deadLetters);
        for (String eventType : EventTypes.SUBSCRIBED) {
            String queueName = QUEUE_PREFIX + eventType;
            String deadLetterName = queueName + DLQ_SUFFIX;
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
     * Message không hợp lệ ({@link InvalidEventException}) không retry mà vào DLQ ngay.
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
