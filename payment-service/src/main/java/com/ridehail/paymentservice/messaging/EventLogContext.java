package com.ridehail.paymentservice.messaging;

import java.util.Map;
import java.util.UUID;

import org.slf4j.MDC;

/**
 * Gắn correlationId, eventId, tripId vào MDC trong lúc xử lý một event để log của
 * consumer nối được với log HTTP và log của service khác. Đóng context sẽ trả MDC về
 * trạng thái cũ.
 */
public final class EventLogContext implements AutoCloseable {

    private final Map<String, String> previous;

    private EventLogContext(Map<String, String> previous) {
        this.previous = previous;
    }

    public static EventLogContext open(String correlationId, UUID eventId, String eventType, UUID tripId,
            String instanceId) {
        Map<String, String> previous = MDC.getCopyOfContextMap();
        MDC.put("correlationId", correlationId);
        MDC.put("eventId", String.valueOf(eventId));
        MDC.put("action", eventType);
        MDC.put("instanceId", instanceId);
        if (tripId != null) {
            MDC.put("tripId", tripId.toString());
        }
        return new EventLogContext(previous);
    }

    @Override
    public void close() {
        MDC.clear();
        if (this.previous != null) {
            MDC.setContextMap(this.previous);
        }
    }

}
