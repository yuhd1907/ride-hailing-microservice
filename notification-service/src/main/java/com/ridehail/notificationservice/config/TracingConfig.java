package com.ridehail.notificationservice.config;

import io.micrometer.common.KeyValue;
import io.micrometer.observation.ObservationFilter;
import io.micrometer.observation.ObservationPredicate;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.config.ContainerCustomizer;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;
import org.springframework.amqp.rabbit.support.micrometer.RabbitMessageReceiverContext;
import org.springframework.amqp.rabbit.support.micrometer.RabbitMessageSenderContext;
import org.springframework.boot.autoconfigure.amqp.RabbitTemplateCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.observation.ServerRequestObservationContext;

/**
 * Cấu hình distributed tracing. Gắn correlationId làm tag của span để tìm trace trên
 * Zipkin theo đúng ID dùng trong log, và bỏ qua các span không phải nghiệp vụ: request
 * tới /actuator (healthcheck của Docker, Prometheus), tác vụ định kỳ @Scheduled
 */
@Configuration
public class TracingConfig {

    private static final String CORRELATION_HEADER = "X-Correlation-ID";

    /**
     * Tạo span PRODUCER khi publish lên RabbitMQ và gắn trace vào header của message.
     * Spring Boot 3.2 chưa có thuộc tính cấu hình cho việc này nên bật bằng code
     */
    @Bean
    public RabbitTemplateCustomizer rabbitTemplateObservation() {
        return template -> template.setObservationEnabled(true);
    }

    /**
     * Tạo span CONSUMER khi nhận message, nối tiếp trace từ header do bên publish gắn vào
     */
    @Bean
    public ContainerCustomizer<SimpleMessageListenerContainer> listenerObservation() {
        return container -> container.setObservationEnabled(true);
    }

    @Bean
    public ObservationPredicate skipNoisyObservations() {
        return (name, context) -> {
            if (name.startsWith("tasks.scheduled")) {
                return false;
            }
            if (context instanceof ServerRequestObservationContext request) {
                String path = request.getCarrier().getRequestURI();
                return path == null || !path.startsWith("/actuator");
            }
            return true;
        };
    }

    @Bean
    public ObservationFilter correlationIdTag() {
        return context -> {
            if (context instanceof ServerRequestObservationContext request) {
                tag(context, request.getCarrier().getHeader(CORRELATION_HEADER));
            }
            else if (context instanceof RabbitMessageReceiverContext received) {
                tag(context, messageCorrelationId(received.getCarrier()));
            }
            else if (context instanceof RabbitMessageSenderContext sent) {
                tag(context, messageCorrelationId(sent.getCarrier()));
            }
            return context;
        };
    }

    private static void tag(io.micrometer.observation.Observation.Context context, String correlationId) {
        if (correlationId != null && !correlationId.isBlank()) {
            context.addHighCardinalityKeyValue(KeyValue.of("correlationId", correlationId));
        }
    }

    private static String messageCorrelationId(Message message) {
        Object header = message == null ? null : message.getMessageProperties().getHeader("x-correlation-id");
        return header == null ? null : header.toString();
    }

}
