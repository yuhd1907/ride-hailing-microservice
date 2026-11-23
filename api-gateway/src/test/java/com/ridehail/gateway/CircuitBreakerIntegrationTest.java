package com.ridehail.gateway;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import com.sun.net.httpserver.HttpServer;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Chạy Gateway thật với đúng các route trong application.yml. Hai service phía sau được
 * thay bằng HTTP server cục bộ để điều khiển được lúc lỗi, lúc treo, lúc dừng hẳn
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = { "jwt.secret=test-secret-test-secret-test-secret-test-secret", "eureka.client.enabled=false",
                "resilience4j.circuitbreaker.configs.default.wait-duration-in-open-state=2s",
                "resilience4j.timelimiter.configs.default.timeout-duration=1s" })
class CircuitBreakerIntegrationTest {

    private static final StubService USERS = new StubService();

    private static final StubService DRIVERS = new StubService();

    @LocalServerPort
    private int port;

    @Autowired
    private CircuitBreakerRegistry circuitBreakers;

    private WebTestClient gateway;

    @DynamicPropertySource
    static void discovery(DynamicPropertyRegistry registry) {
        registry.add("spring.cloud.discovery.client.simple.instances[USER-SERVICE][0].uri", USERS::uri);
        registry.add("spring.cloud.discovery.client.simple.instances[DRIVER-SERVICE][0].uri", DRIVERS::uri);
    }

    @BeforeEach
    void healthyServicesAndClosedCircuits() throws IOException {
        USERS.start();
        USERS.behave(Mode.OK);
        DRIVERS.start();
        DRIVERS.behave(Mode.OK);
        circuitBreakers.getAllCircuitBreakers().forEach(CircuitBreaker::reset);
        gateway = WebTestClient.bindToServer()
            .baseUrl("http://localhost:" + port)
            .responseTimeout(Duration.ofSeconds(20))
            .build();
    }

    @AfterAll
    static void stopServices() {
        USERS.stop();
        DRIVERS.stop();
    }

    @Test
    void healthyServiceIsProxiedAndTheCircuitStaysClosed() {
        for (int call = 0; call < 10; call++) {
            gateway.get().uri("/users/ping").exchange().expectStatus().isOk().expectBody(String.class).isEqualTo("UP");
        }
        assertEquals(CircuitBreaker.State.CLOSED, state("user-service"));
        assertEquals(10, USERS.calls());
    }

    @Test
    void repeatedServerErrorsOpenTheCircuitAndLaterCallsNeverReachTheService() {
        USERS.behave(Mode.ERROR);
        for (int call = 0; call < 5; call++) {
            gateway.get()
                .uri("/users/ping")
                .exchange()
                .expectStatus()
                .isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR)
                .expectBody()
                .jsonPath("$.service")
                .isEqualTo("user-service");
        }
        assertEquals(CircuitBreaker.State.OPEN, state("user-service"));
        assertEquals(5, USERS.calls());

        for (int call = 0; call < 3; call++) {
            gateway.get()
                .uri("/users/ping")
                .exchange()
                .expectStatus()
                .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                .expectHeader()
                .exists("X-Correlation-ID")
                .expectBody()
                .jsonPath("$.circuitState")
                .isEqualTo("OPEN")
                .jsonPath("$.service")
                .isEqualTo("user-service");
        }
        assertEquals(5, USERS.calls(), "Khi circuit mở, Gateway không được gọi service nữa");

        // Breaker tách theo service: user-service hỏng không kéo driver-service theo.
        gateway.get().uri("/drivers/ping").exchange().expectStatus().isOk().expectBody(String.class).isEqualTo("UP");
        assertEquals(CircuitBreaker.State.CLOSED, state("driver-service"));
    }

    @Test
    void hungServiceTimesOutThenFailsFastInsteadOfWaiting() {
        USERS.behave(Mode.HANG);
        for (int call = 0; call < 5; call++) {
            long started = System.nanoTime();
            gateway.get().uri("/users/ping").exchange().expectStatus().isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
            long elapsedMs = Duration.ofNanos(System.nanoTime() - started).toMillis();
            assertTrue(elapsedMs >= 900, "Lần gọi treo phải chờ tới timeout (1s), thực tế " + elapsedMs + "ms");
        }
        assertEquals(CircuitBreaker.State.OPEN, state("user-service"));

        long started = System.nanoTime();
        gateway.get().uri("/users/ping").exchange().expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        long elapsedMs = Duration.ofNanos(System.nanoTime() - started).toMillis();
        assertTrue(elapsedMs < 500, "Circuit mở phải trả lỗi ngay, thực tế " + elapsedMs + "ms");
        assertEquals(5, USERS.calls());
    }

    @Test
    void stoppedServiceIsCutOffAndTheCircuitClosesByItselfOnceItIsBack() throws IOException {
        USERS.stop();
        for (int call = 0; call < 5; call++) {
            gateway.get().uri("/users/ping").exchange().expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        }
        assertEquals(CircuitBreaker.State.OPEN, state("user-service"));

        // Service sống lại trong lúc circuit còn mở: vẫn bị chặn cho tới khi hết thời
        // gian chờ.
        USERS.start();
        gateway.get()
            .uri("/users/ping")
            .exchange()
            .expectStatus()
            .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
            .expectBody()
            .jsonPath("$.circuitState")
            .isEqualTo("OPEN");
        assertEquals(0, USERS.calls());

        // Hết 2s chờ, breaker tự sang HALF_OPEN mà không cần thao tác tay.
        await().atMost(Duration.ofSeconds(10))
            .untilAsserted(() -> assertEquals(CircuitBreaker.State.HALF_OPEN, state("user-service")));
        for (int call = 0; call < 3; call++) {
            gateway.get().uri("/users/ping").exchange().expectStatus().isOk().expectBody(String.class).isEqualTo("UP");
        }
        assertEquals(CircuitBreaker.State.CLOSED, state("user-service"));
        assertEquals(3, USERS.calls());
    }

    @Test
    void halfOpenCircuitReopensWhenTheServiceIsStillBroken() {
        USERS.behave(Mode.ERROR);
        for (int call = 0; call < 5; call++) {
            gateway.get().uri("/users/ping").exchange().expectStatus().is5xxServerError();
        }
        await().atMost(Duration.ofSeconds(10))
            .untilAsserted(() -> assertEquals(CircuitBreaker.State.HALF_OPEN, state("user-service")));
        for (int call = 0; call < 3; call++) {
            gateway.get().uri("/users/ping").exchange().expectStatus().is5xxServerError();
        }
        assertEquals(CircuitBreaker.State.OPEN, state("user-service"));
        assertEquals(8, USERS.calls());
    }

    @Test
    void clientErrorsDoNotOpenTheCircuit() {
        USERS.behave(Mode.NOT_FOUND);
        for (int call = 0; call < 10; call++) {
            gateway.get().uri("/users/ping").exchange().expectStatus().isNotFound();
        }
        assertEquals(CircuitBreaker.State.CLOSED, state("user-service"));
    }

    @Test
    void fallbackEndpointDoesNotAnswerForUnknownServices() {
        gateway.get().uri("/fallback/anything").exchange().expectStatus().isNotFound();
    }

    private CircuitBreaker.State state(String name) {
        return circuitBreakers.circuitBreaker(name).getState();
    }

    private enum Mode {

        OK, ERROR, NOT_FOUND, HANG

    }

    /**
     * Service giả giữ nguyên một cổng qua các lần dừng/khởi động lại, giống một container
     * bị stop rồi start
     */
    private static final class StubService {

        private final AtomicInteger calls = new AtomicInteger();

        private volatile Mode mode = Mode.OK;

        private HttpServer server;

        private int boundPort;

        synchronized String uri() {
            if (boundPort == 0) {
                try {
                    start();
                }
                catch (IOException ex) {
                    throw new IllegalStateException(ex);
                }
            }
            return "http://localhost:" + boundPort;
        }

        synchronized void start() throws IOException {
            if (server != null) {
                return;
            }
            server = HttpServer.create(new InetSocketAddress("localhost", boundPort), 0);
            boundPort = server.getAddress().getPort();
            server.setExecutor(Executors.newCachedThreadPool(runnable -> {
                Thread thread = new Thread(runnable, "stub-service");
                thread.setDaemon(true);
                return thread;
            }));
            server.createContext("/", exchange -> {
                calls.incrementAndGet();
                Mode current = mode;
                if (current == Mode.HANG) {
                    try {
                        Thread.sleep(4000);
                    }
                    catch (InterruptedException ex) {
                        Thread.currentThread().interrupt();
                    }
                }
                int status = switch (current) {
                    case ERROR -> 500;
                    case NOT_FOUND -> 404;
                    default -> 200;
                };
                byte[] body = (status == 200 ? "UP" : "{\"message\":\"downstream failure\"}")
                    .getBytes(StandardCharsets.UTF_8);
                try (exchange) {
                    exchange.sendResponseHeaders(status, body.length);
                    exchange.getResponseBody().write(body);
                }
                catch (IOException ignored) {
                    // Gateway đã bỏ kết nối sau khi quá timeout.
                }
            });
            server.start();
        }

        synchronized void stop() {
            if (server != null) {
                server.stop(0);
                server = null;
            }
        }

        void behave(Mode next) {
            mode = next;
            calls.set(0);
        }

        int calls() {
            return calls.get();
        }

    }

}
