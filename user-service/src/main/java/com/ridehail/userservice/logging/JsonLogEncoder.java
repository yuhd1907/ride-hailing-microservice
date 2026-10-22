package com.ridehail.userservice.logging;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.encoder.EncoderBase;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Serialize log fields so quotes, backslashes and newlines cannot corrupt JSONL. */
public class JsonLogEncoder extends EncoderBase<ILoggingEvent> {

    private static final ObjectMapper JSON = new ObjectMapper();

    private String serviceName = "unknown";

    private String instanceId = "unknown";

    public void setServiceName(String serviceName) {
        this.serviceName = serviceName;
    }

    public void setInstanceId(String instanceId) {
        this.instanceId = instanceId;
    }

    @Override
    public byte[] headerBytes() {
        return new byte[0];
    }

    @Override
    public byte[] footerBytes() {
        return new byte[0];
    }

    @Override
    public byte[] encode(ILoggingEvent event) {
        Map<String, String> mdc = event.getMDCPropertyMap();
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("timestamp", Instant.ofEpochMilli(event.getTimeStamp()).toString());
        entry.put("serviceName", serviceName);
        entry.put("instanceId", mdc.getOrDefault("instanceId", instanceId));
        entry.put("level", event.getLevel().toString());
        entry.put("correlationId", mdc.getOrDefault("correlationId", "N/A"));
        entry.put("eventId", mdc.getOrDefault("eventId", "N/A"));
        entry.put("tripId", mdc.getOrDefault("tripId", "N/A"));
        entry.put("action", mdc.getOrDefault("action", "N/A"));
        String message = event.getFormattedMessage();
        if (event.getThrowableProxy() != null) {
            message += "\n" + ThrowableProxyUtil.asString(event.getThrowableProxy());
        }
        entry.put("message", message);
        try {
            return (JSON.writeValueAsString(entry) + "\n").getBytes(StandardCharsets.UTF_8);
        }
        catch (JsonProcessingException ex) {
            addError("Cannot serialize JSON log event", ex);
            return new byte[0];
        }
    }

}
