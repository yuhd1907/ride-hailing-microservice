package com.ridehail.userservice.config;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component("rideHailingRequestContextFilter")
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestContextFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestContextFilter.class);

    private final String instanceId;

    public RequestContextFilter(@Value("${eureka.instance.instance-id:${spring.application.name}}") String instanceId) {
        this.instanceId = instanceId;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
            @NonNull FilterChain chain) throws ServletException, IOException {
        long startTime = System.currentTimeMillis();
        Map<String, String> previous = MDC.getCopyOfContextMap();
        MDC.clear();
        String correlationId = request.getHeader("X-Correlation-ID");
        if (correlationId == null || correlationId.isBlank() || correlationId.length() > 128) {
            correlationId = UUID.randomUUID().toString();
        }
        MDC.put("correlationId", correlationId);
        MDC.put("instanceId", instanceId);
        String headerUserId = request.getHeader("X-User-Id");
        if (headerUserId != null && !headerUserId.isBlank()) {
            MDC.put("userId", headerUserId);
        }
        response.setHeader("X-Correlation-ID", correlationId);
        try {
            chain.doFilter(request, response);
        }
        finally {
            if (MDC.get("action") == null && request.getMethod() != null && request.getRequestURI() != null) {
                MDC.put("action", request.getMethod() + " " + request.getRequestURI());
            }
            long durationMs = System.currentTimeMillis() - startTime;
            log.info("request completed: {} {} ({}) in {}ms", request.getMethod(), request.getRequestURI(),
                    response.getStatus(), durationMs);
            MDC.clear();
            if (previous != null) {
                MDC.setContextMap(previous);
            }
        }
    }

}
