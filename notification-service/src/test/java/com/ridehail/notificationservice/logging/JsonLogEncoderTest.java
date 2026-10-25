package com.ridehail.notificationservice.logging;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.LoggingEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class JsonLogEncoderTest {

    @Test
    void quotesBackslashesAndNewlinesProduceOneValidJsonRecord() throws Exception {
        String message = "quoted \"value\" at C:\\logs\\file\nnext line\twith tab";
        var event = new LoggingEvent();
        event.setLevel(Level.INFO);
        event.setMessage(message);
        event.setTimeStamp(1700000000000L);
        event.setMDCPropertyMap(Map.of("correlationId", "trace-123", "instanceId", "instance-1", "eventId",
                "5b1f2c3a-8e7d-4c6b-9a5f-1e2d3c4b5a69", "tripId", "93d8f465-65ac-491d-a4d0-b29cc65775cd"));
        var encoder = new JsonLogEncoder();
        encoder.setServiceName("test-service");
        String encoded = new String(encoder.encode(event), StandardCharsets.UTF_8);
        assertEquals(1, encoded.lines().count());
        var parsed = new ObjectMapper().readTree(encoded);
        assertEquals(12, parsed.size());
        assertEquals(message, parsed.get("message").asText());
        assertEquals("test-service", parsed.get("serviceName").asText());
        assertEquals("trace-123", parsed.get("correlationId").asText());
        assertEquals("instance-1", parsed.get("instanceId").asText());
        assertEquals("5b1f2c3a-8e7d-4c6b-9a5f-1e2d3c4b5a69", parsed.get("eventId").asText());
        assertEquals("93d8f465-65ac-491d-a4d0-b29cc65775cd", parsed.get("tripId").asText());
    }

}
