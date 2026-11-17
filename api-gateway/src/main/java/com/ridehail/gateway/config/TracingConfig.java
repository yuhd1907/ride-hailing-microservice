package com.ridehail.gateway.config;

import io.micrometer.common.KeyValue;
import io.micrometer.observation.ObservationFilter;
import io.micrometer.observation.ObservationPredicate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.reactive.observation.ServerRequestObservationContext;

/**
 * Cấu hình distributed tracing. Gắn correlationId làm tag của span để tìm trace trên
 * Zipkin theo đúng ID dùng trong log, và bỏ qua các span không phải nghiệp vụ: request
 * tới /actuator (healthcheck của Docker, Prometheus), tác vụ định kỳ @Scheduled
 */
@Configuration
public class TracingConfig {

    private static final String CORRELATION_HEADER = "X-Correlation-ID";

    @Bean
    public ObservationPredicate skipNoisyObservations() {
        return (name, context) -> {
            if (name.startsWith("tasks.scheduled")) {
                return false;
            }
            if (context instanceof ServerRequestObservationContext request) {
                String path = request.getCarrier().getURI().getPath();
                return path == null || !path.startsWith("/actuator");
            }
            return true;
        };
    }

    @Bean
    public ObservationFilter correlationIdTag() {
        return context -> {
            if (context instanceof ServerRequestObservationContext request) {
                tag(context, request.getResponse().getHeaders().getFirst(CORRELATION_HEADER));
            }
            return context;
        };
    }

    private static void tag(io.micrometer.observation.Observation.Context context, String correlationId) {
        if (correlationId != null && !correlationId.isBlank()) {
            context.addHighCardinalityKeyValue(KeyValue.of("correlationId", correlationId));
        }
    }

}
