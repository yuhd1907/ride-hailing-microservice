package com.ridehail.notificationservice.config;

import jakarta.servlet.ServletException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class RequestContextFilterTest {

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

    @Test
    void missingCorrelationIdIsGenerated() {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();
        var filter = new RequestContextFilter("instance-1");
        assertDoesNotThrow(() -> filter.doFilter(request, response, (req, res) -> {
        }));
        assertNotNull(response.getHeader("X-Correlation-ID"));
        assertEquals(36, response.getHeader("X-Correlation-ID").length());
    }

}
