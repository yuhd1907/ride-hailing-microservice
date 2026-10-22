package com.ridehail.gateway.filter;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import javax.crypto.SecretKey;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

@Component
public class JwtAuthAndBlacklistFilter implements GlobalFilter, Ordered {

    private static final Set<String> PUBLIC_PATHS = Set.of("/auth/login", "/auth/register", "/users/ping",
            "/drivers/ping");

    private final ReactiveStringRedisTemplate redisTemplate;

    private final SecretKey secretKey;

    public JwtAuthAndBlacklistFilter(ReactiveStringRedisTemplate redisTemplate, @Value("${jwt.secret}") String secret) {
        this.redisTemplate = redisTemplate;
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        // Client-supplied identity headers must never reach a downstream service.
        var request = exchange.getRequest().mutate().headers(headers -> {
            headers.remove("X-User-Id");
            headers.remove("X-User-Email");
            headers.remove("X-User-Roles");
        }).build();
        var sanitized = exchange.mutate().request(request).build();
        String path = request.getURI().getPath();
        boolean publicDriverRead = HttpMethod.GET.equals(request.getMethod())
                && (path.equals("/drivers") || path.startsWith("/drivers/"));
        if (PUBLIC_PATHS.contains(path) || publicDriverRead) {
            return chain.filter(sanitized);
        }

        String authorization = request.getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.regionMatches(true, 0, "Bearer ", 0, 7)
                || authorization.substring(7).isBlank()) {
            return reject(sanitized, HttpStatus.UNAUTHORIZED);
        }
        String token = authorization.substring(7).trim();
        final Claims claims;
        try {
            claims = Jwts.parser().verifyWith(secretKey).build().parseSignedClaims(token).getPayload();
            if (claims.getSubject() == null || claims.getSubject().isBlank()) {
                return reject(sanitized, HttpStatus.UNAUTHORIZED);
            }
        }
        catch (JwtException | IllegalArgumentException ex) {
            return reject(sanitized, HttpStatus.UNAUTHORIZED);
        }
        return Mono.defer(() -> redisTemplate.hasKey("blacklist:" + token))
            .defaultIfEmpty(false)
            .onErrorResume(DataAccessException.class,
                    ex -> reject(sanitized, HttpStatus.SERVICE_UNAVAILABLE).then(Mono.empty()))
            .flatMap(revoked -> {
                if (revoked) {
                    return reject(sanitized, HttpStatus.UNAUTHORIZED);
                }
                var authenticated = request.mutate().headers(headers -> {
                    headers.set("X-User-Id", claims.getSubject());
                    Object email = claims.get("email");
                    Object roles = claims.get("roles");
                    if (email instanceof String value) {
                        headers.set("X-User-Email", value);
                    }
                    if (roles instanceof String value) {
                        headers.set("X-User-Roles", value);
                    }
                }).build();
                return chain.filter(sanitized.mutate().request(authenticated).build());
            });
    }

    private Mono<Void> reject(ServerWebExchange exchange, HttpStatus status) {
        exchange.getResponse().setStatusCode(status);
        return exchange.getResponse().setComplete();
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 2;
    }

}
