package com.ridehail.paymentservice.config;

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
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Đọc X-Correlation-ID do Gateway gắn (hoặc tự sinh UUID) và đưa vào MDC để mọi dòng log
 * của request đều mang correlationId và instanceId. Mỗi request ghi một dòng log tổng kết
 * (method, đường dẫn, mã trạng thái, thời gian), trừ health check của actuator.
 */
@Component("rideHailingRequestContextFilter")
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestContextFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestContextFilter.class);

    private final String instanceId;

    public RequestContextFilter(@Value("${eureka.instance.instance-id:${spring.application.name}}") String instanceId) {
        this.instanceId = instanceId;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        MDC.clear();
        String correlationId = request.getHeader("X-Correlation-ID");
        if (correlationId == null || correlationId.isBlank() || correlationId.length() > 128) {
            correlationId = UUID.randomUUID().toString();
        }
        MDC.put("correlationId", correlationId);
        MDC.put("instanceId", this.instanceId);
        response.setHeader("X-Correlation-ID", correlationId);
        long started = System.nanoTime();
        try {
            chain.doFilter(request, response);
        }
        finally {
            String uri = request.getRequestURI();
            if (uri == null || !uri.startsWith("/actuator")) {
                log.info("{} {} -> {} ({} ms)", request.getMethod(), uri, response.getStatus(),
                        (System.nanoTime() - started) / 1_000_000);
            }
            MDC.clear();
            if (previous != null) {
                MDC.setContextMap(previous);
            }
        }
    }

}
