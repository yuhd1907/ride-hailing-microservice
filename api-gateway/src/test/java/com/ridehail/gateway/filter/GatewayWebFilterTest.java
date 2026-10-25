package com.ridehail.gateway.filter;

import java.net.URI;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class GatewayWebFilterTest {

    @ParameterizedTest
    @ValueSource(strings = { "/internal", "/internal/unknown", "/internal/drivers/id/reserve",
            "/drivers/../internal/drivers/id/reserve", "/drivers/%2e%2e/internal/drivers/id/reserve",
            "/internal;parameter/drivers/id/reserve" })
    void internalRequestsAreBlockedEvenWithoutAMatchingRoute(String path) {
        var exchange = MockServerWebExchange
            .from(MockServerHttpRequest.method(HttpMethod.GET, URI.create(path)).build());
        var forwarded = new AtomicBoolean();
        new InternalBlockFilter().filter(exchange, next -> {
            forwarded.set(true);
            return Mono.empty();
        }).block();
        assertEquals(HttpStatus.FORBIDDEN, exchange.getResponse().getStatusCode());
        assertFalse(forwarded.get());
    }

    @Test
    void correlationHeaderSurvivesTheWholeRequest() {
        var exchange = MockServerWebExchange
            .from(MockServerHttpRequest.get("/ping").header("X-Correlation-ID", "trace-123"));
        new CorrelationIdFilter().filter(exchange, next -> {
            assertEquals("trace-123", next.getRequest().getHeaders().getFirst("X-Correlation-ID"));
            return Mono.empty();
        }).block();
        assertEquals("trace-123", exchange.getResponse().getHeaders().getFirst("X-Correlation-ID"));
    }

}
