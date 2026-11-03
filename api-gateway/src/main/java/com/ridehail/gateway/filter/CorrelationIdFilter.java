package com.ridehail.gateway.filter;

import java.util.UUID;

import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * Filter tạo và truyền X-Correlation-ID cho mọi request đi qua Gateway Nếu client gửi sẵn
 * Correlation-ID thì giữ nguyên, nếu không thì tự sinh UUID
 */
@Component
public class CorrelationIdFilter implements WebFilter, Ordered {

    private static final String CORRELATION_ID_HEADER = "X-Correlation-ID";

    @Override
    @NonNull
    public Mono<Void> filter(@NonNull ServerWebExchange exchange, @NonNull WebFilterChain chain) {
        String correlationId = exchange.getRequest().getHeaders().getFirst(CORRELATION_ID_HEADER);

        if (correlationId == null || correlationId.isBlank() || correlationId.length() > 128) {
            correlationId = UUID.randomUUID().toString();
        }

        String finalCorrelationId = correlationId;
        ServerHttpRequest mutatedRequest = exchange.getRequest()
            .mutate()
            .headers(headers -> headers.set(CORRELATION_ID_HEADER, finalCorrelationId))
            .build();

        // Đặt duy nhất một X-Correlation-ID vào response header (kể cả khi downstream
        // cũng trả về header này)
        exchange.getResponse().getHeaders().set(CORRELATION_ID_HEADER, finalCorrelationId);
        exchange.getResponse().beforeCommit(() -> {
            exchange.getResponse().getHeaders().set(CORRELATION_ID_HEADER, finalCorrelationId);
            return Mono.empty();
        });

        return chain.filter(exchange.mutate().request(mutatedRequest).build());
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE; // Chạy đầu tiên
    }

}
