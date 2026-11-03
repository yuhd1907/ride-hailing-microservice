package com.ridehail.gateway.filter;

import java.util.ArrayDeque;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatus;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * Filter chặn tuyệt đối mọi request từ bên ngoài vào endpoint /internal/** Chỉ cho phép
 * service-to-service gọi trực tiếp (không qua Gateway)
 *
 * Khi request đến Gateway với path /internal/**, trả về 403 Forbidden ngay lập tức
 */
@Component
public class InternalBlockFilter implements WebFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(InternalBlockFilter.class);

    @Override
    @NonNull
    public Mono<Void> filter(@NonNull ServerWebExchange exchange, @NonNull WebFilterChain chain) {
        String path = canonicalPath(exchange.getRequest().getURI().getPath());

        if (path.equals("/internal") || path.startsWith("/internal/")) {
            log.warn("Blocked external access to internal endpoint: {}", path);
            exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
            return exchange.getResponse().setComplete();
        }

        return chain.filter(exchange);
    }

    private String canonicalPath(String path) {
        // Match servlet normalization too: encoded dots, matrix parameters and
        // backslashes must not turn a public prefix into an internal endpoint.
        var segments = new ArrayDeque<String>();
        for (String part : path.replace('\\', '/').split("/")) {
            String segment = part.split(";", 2)[0];
            if (segment.isEmpty() || segment.equals(".")) {
                continue;
            }
            if (segment.equals("..")) {
                if (!segments.isEmpty()) {
                    segments.removeLast();
                }
            }
            else {
                segments.addLast(segment);
            }
        }
        return "/" + String.join("/", segments);
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 1; // Chạy sau CorrelationId, trước JWT
    }

}
