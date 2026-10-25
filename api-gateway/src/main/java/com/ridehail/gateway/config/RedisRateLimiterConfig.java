package com.ridehail.gateway.config;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import reactor.core.publisher.Mono;

/**
 * Cấu hình Redis Rate Limiter cho API Gateway Sử dụng Token Bucket Algorithm với key = IP
 * address
 */
@Configuration
public class RedisRateLimiterConfig {

    /**
     * KeyResolver dựa trên IP Address của client Mỗi IP bị giới hạn 10 req/s, burst 20
     */
    @Bean
    public KeyResolver ipKeyResolver() {
        return exchange -> {
            var remote = exchange.getRequest().getRemoteAddress();
            String ip = remote == null ? "unknown"
                    : remote.getAddress() == null ? remote.getHostString() : remote.getAddress().getHostAddress();
            return Mono.just(ip);
        };
    }

}
