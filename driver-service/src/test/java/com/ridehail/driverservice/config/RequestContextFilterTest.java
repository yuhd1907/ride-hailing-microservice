package com.ridehail.driverservice.config;

import jakarta.servlet.ServletException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class RequestContextFilterTest {

    @Test
    void filterDoesNotCollideWithTheSpringMvcRequestContextFilter() {
        new WebApplicationContextRunner().withConfiguration(AutoConfigurations.of(WebMvcAutoConfiguration.class))
            .withUserConfiguration(RequestContextFilter.class)
            .withPropertyValues("spring.application.name=test")
            .run(context -> org.assertj.core.api.Assertions.assertThat(context)
                .hasNotFailed()
                .hasSingleBean(RequestContextFilter.class));
    }

    @AfterEach
    void clear() {
        MDC.clear();
    }

    @Test
    void correlationIsPreservedAndRequestFieldsDoNotLeakAfterAnError() {
        MDC.put("outer", "preserved");
        var request = new MockHttpServletRequest();
        request.addHeader("X-Correlation-ID", "gateway-trace");
        var response = new MockHttpServletResponse();
        var filter = new RequestContextFilter("instance-1");
        assertThrows(ServletException.class, () -> filter.doFilter(request, response, (req, res) -> {
            assertEquals("gateway-trace", MDC.get("correlationId"));
            assertEquals("instance-1", MDC.get("instanceId"));
            assertNull(MDC.get("outer"));
            MDC.put("tripId", "private-to-this-request");
            throw new ServletException("request failed");
        }));
        assertEquals("gateway-trace", response.getHeader("X-Correlation-ID"));
        assertNull(MDC.get("tripId"));
        assertNull(MDC.get("correlationId"));
        assertEquals("preserved", MDC.get("outer"));
    }

}
