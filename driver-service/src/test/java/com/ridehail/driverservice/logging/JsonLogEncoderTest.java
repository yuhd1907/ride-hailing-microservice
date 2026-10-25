package com.ridehail.driverservice.logging;

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
        event.setMDCPropertyMap(Map.of("correlationId", "trace-123", "instanceId", "instance-1", "userId",
                "26a7f8fe-79a8-49ea-a46a-9529e5c3e381", "driverId", "fd699acc-6544-44a9-9634-5396060c61b8", "tripId",
                "93d8f465-65ac-491d-a4d0-b29cc65775cd", "reservationId", "734b66d6-cdc0-487a-9e06-32a81246d891"));
        var encoder = new JsonLogEncoder();
        encoder.setServiceName("test-service");
        String encoded = new String(encoder.encode(event), StandardCharsets.UTF_8);
        assertEquals(1, encoded.lines().count());
        var parsed = new ObjectMapper().readTree(encoded);
        assertEquals(12, parsed.size());
        assertEquals(message, parsed.get("message").asText());
        assertEquals("trace-123", parsed.get("correlationId").asText());
        assertEquals("instance-1", parsed.get("instanceId").asText());
        assertEquals("26a7f8fe-79a8-49ea-a46a-9529e5c3e381", parsed.get("userId").asText());
        assertEquals("fd699acc-6544-44a9-9634-5396060c61b8", parsed.get("driverId").asText());
        assertEquals("93d8f465-65ac-491d-a4d0-b29cc65775cd", parsed.get("tripId").asText());
        assertEquals("734b66d6-cdc0-487a-9e06-32a81246d891", parsed.get("reservationId").asText());
    }

}
