package com.ridehail.gateway.controller;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeoutException;

import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.server.ServerWebExchange;

/**
 * Điểm trả lỗi chung khi circuit breaker của một service chặn hoặc ghi nhận lỗi. Bộ lọc
 * CircuitBreaker trên từng route forward về đây (fallbackUri), nên client luôn nhận JSON
 * thống nhất thay vì phải chờ service đang hỏng
 */
@RestController
public class CircuitBreakerFallbackController {

    private final CircuitBreakerRegistry circuitBreakers;

    public CircuitBreakerFallbackController(CircuitBreakerRegistry circuitBreakers) {
        this.circuitBreakers = circuitBreakers;
    }

    @RequestMapping("/fallback/{service}")
    public ResponseEntity<Map<String, Object>> fallback(@PathVariable String service, ServerWebExchange exchange) {
        var breaker = circuitBreakers.find(service);
        if (breaker.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        Throwable cause = exchange.getAttribute(ServerWebExchangeUtils.CIRCUITBREAKER_EXECUTION_EXCEPTION_ATTR);
        HttpStatusCode status = HttpStatus.SERVICE_UNAVAILABLE;
        String message = service + " đang không khả dụng";
        if (cause instanceof CallNotPermittedException) {
            message = "Circuit breaker đang mở: " + service + " tạm thời bị ngắt, vui lòng thử lại sau";
        }
        else if (cause instanceof TimeoutException) {
            status = HttpStatus.GATEWAY_TIMEOUT;
            message = service + " không phản hồi trong thời gian cho phép";
        }
        else if (cause instanceof HttpStatusCodeException downstream) {
            // Service có trả lời nhưng là lỗi 5xx: giữ nguyên mã lỗi của service.
            status = downstream.getStatusCode();
            message = service + " trả về lỗi";
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status", status.value());
        HttpStatus resolved = HttpStatus.resolve(status.value());
        body.put("error", resolved == null ? "HTTP error" : resolved.getReasonPhrase());
        body.put("message", message);
        body.put("service", service);
        body.put("circuitState", breaker.get().getState().name());
        body.put("correlationId", exchange.getRequest().getHeaders().getFirst("X-Correlation-ID"));
        return ResponseEntity.status(status).body(body);
    }

}
