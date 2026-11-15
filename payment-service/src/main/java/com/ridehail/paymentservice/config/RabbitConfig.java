package com.ridehail.paymentservice.config;

import java.util.Map;

import com.ridehail.paymentservice.messaging.EventTypes;
import com.ridehail.paymentservice.messaging.InvalidEventException;
import com.ridehail.paymentservice.messaging.LoggingDeadLetterRecoverer;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
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
 * Khai báo exchange, queue và dead-letter queue của Payment Service.
 * <p>
 * Luồng lỗi: listener lỗi được retry tại chỗ (cấu hình
 * spring.rabbitmq.listener.simple.retry), hết số lần thử thì
 * {@link LoggingDeadLetterRecoverer} reject message, RabbitMQ chuyển message qua exchange
 * {@value #DEAD_LETTER_EXCHANGE} vào queue {@value #TRIP_COMPLETED_DLQ}.
 */
@Configuration
public class RabbitConfig {

    public static final String EVENTS_EXCHANGE = "rideflow.events";

    public static final String DEAD_LETTER_EXCHANGE = "rideflow.dlx";

    public static final String TRIP_COMPLETED_QUEUE = "payment-service.trip.completed";

    public static final String TRIP_COMPLETED_DLQ = TRIP_COMPLETED_QUEUE + ".dlq";

    @Bean
    public TopicExchange eventsExchange() {
        return ExchangeBuilder.topicExchange(EVENTS_EXCHANGE).durable(true).build();
    }

    @Bean
    public DirectExchange deadLetterExchange() {
        return ExchangeBuilder.directExchange(DEAD_LETTER_EXCHANGE).durable(true).build();
    }

    @Bean
    public Queue tripCompletedQueue() {
        return QueueBuilder.durable(TRIP_COMPLETED_QUEUE)
            .deadLetterExchange(DEAD_LETTER_EXCHANGE)
            .deadLetterRoutingKey(TRIP_COMPLETED_DLQ)
            .build();
    }

    @Bean
    public Queue tripCompletedDeadLetterQueue() {
        return QueueBuilder.durable(TRIP_COMPLETED_DLQ).build();
    }

    @Bean
    public Binding tripCompletedBinding() {
        return BindingBuilder.bind(tripCompletedQueue()).to(eventsExchange()).with(EventTypes.TRIP_COMPLETED);
    }

    @Bean
    public Binding tripCompletedDeadLetterBinding() {
        return BindingBuilder.bind(tripCompletedDeadLetterQueue()).to(deadLetterExchange()).with(TRIP_COMPLETED_DLQ);
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
