package com.ridehail.gateway.filter;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Date;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class JwtAuthAndBlacklistFilterTest {

    private static final String SECRET = "mySecretKeyForJwtTokenGenerationRideHailingApp2024VeryLongSecretKey";

    private ReactiveStringRedisTemplate redis;

    private JwtAuthAndBlacklistFilter filter;

    private AtomicReference<ServerWebExchange> forwarded;

    private GatewayFilterChain chain;

    @BeforeEach
    void setup() {
        redis = mock(ReactiveStringRedisTemplate.class);
        filter = new JwtAuthAndBlacklistFilter(redis, SECRET);
        forwarded = new AtomicReference<>();
        chain = exchange -> {
            forwarded.set(exchange);
            return Mono.empty();
        };
    }

    @Test
    void driverMutationRequiresAuthentication() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post("/drivers/id/location"));
        filter.filter(exchange, chain).block(Duration.ofSeconds(2));
        assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
        assertNull(forwarded.get());
        verifyNoInteractions(redis);
    }

    @ParameterizedTest
    @ValueSource(strings = { "/auth/login-extra", "/auth/register/admin", "/drivers-admin" })
    void publicPathsAreNotPrefixWildcards(String path) {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(path));
        filter.filter(exchange, chain).block(Duration.ofSeconds(2));
        assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
        assertNull(forwarded.get());
    }

    @Test
    void publicDriverReadStripsSpoofedIdentity() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/drivers/id")
            .header("X-User-Id", "victim")
            .header("X-User-Email", "victim@example.com")
            .header("X-User-Roles", "ROLE_ADMIN"));
        filter.filter(exchange, chain).block(Duration.ofSeconds(2));
        assertNotNull(forwarded.get());
        assertNull(forwarded.get().getRequest().getHeaders().getFirst("X-User-Id"));
        assertNull(forwarded.get().getRequest().getHeaders().getFirst("X-User-Email"));
        assertNull(forwarded.get().getRequest().getHeaders().getFirst("X-User-Roles"));
        verifyNoInteractions(redis);
    }

    @ParameterizedTest
    @ValueSource(strings = { "/users/ping", "/drivers/ping", "/auth/login", "/auth/register" })
    void exactPublicEndpointsDoNotDependOnRedis(String path) {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get(path));
        filter.filter(exchange, chain).block(Duration.ofSeconds(2));
        assertNotNull(forwarded.get());
        verifyNoInteractions(redis);
    }

    @Test
    void malformedTokenIsRejectedBeforeLookingInRedis() {
        var exchange = authorized("not-a-jwt");
        filter.filter(exchange, chain).block(Duration.ofSeconds(2));
        assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
        verifyNoInteractions(redis);
    }

    @Test
    void expiredTokenIsRejectedBeforeLookingInRedis() {
        var exchange = authorized(token(-10000));
        filter.filter(exchange, chain).block(Duration.ofSeconds(2));
        assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
        verifyNoInteractions(redis);
    }

    @Test
    void validTokenReplacesAllIdentityHeaders() {
        String token = token(60000);
        when(redis.hasKey("blacklist:" + token)).thenReturn(Mono.just(false));
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/users/me")
            .header("Authorization", "bearer " + token)
            .header("X-User-Id", "victim", "second-victim"));
        filter.filter(exchange, chain).block(Duration.ofSeconds(2));
        assertEquals(List.of("usr_real"), forwarded.get().getRequest().getHeaders().get("X-User-Id"));
        assertEquals("real@example.com", forwarded.get().getRequest().getHeaders().getFirst("X-User-Email"));
    }

    @Test
    void revokedTokenNeverReachesTheService() {
        String token = token(60000);
        when(redis.hasKey("blacklist:" + token)).thenReturn(Mono.just(true));
        var exchange = authorized(token);
        filter.filter(exchange, chain).block(Duration.ofSeconds(2));
        assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
        assertNull(forwarded.get());
    }

    @Test
    void unavailableBlacklistFailsClosedWith503() {
        String token = token(60000);
        when(redis.hasKey("blacklist:" + token)).thenReturn(Mono.error(new RedisConnectionFailureException("offline")));
        var exchange = authorized(token);
        filter.filter(exchange, chain).block(Duration.ofSeconds(2));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exchange.getResponse().getStatusCode());
        assertNull(forwarded.get());
    }

    private MockServerWebExchange authorized(String token) {
        return MockServerWebExchange
            .from(MockServerHttpRequest.get("/users/me").header("Authorization", "Bearer " + token));
    }

    private String token(long remainingMillis) {
        return Jwts.builder()
            .subject("usr_real")
            .claim("email", "real@example.com")
            .claim("roles", "ROLE_PASSENGER")
            .expiration(new Date(System.currentTimeMillis() + remainingMillis))
            .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
            .compact();
    }

}
