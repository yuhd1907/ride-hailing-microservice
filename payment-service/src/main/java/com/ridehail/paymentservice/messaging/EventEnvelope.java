package com.ridehail.paymentservice.messaging;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Envelope chung của mọi event trên exchange rideflow.events (docs/event-schema.md, mục
 * 1.3).
 */
public record EventEnvelope(UUID eventId, String eventType, String correlationId, Instant occurredAt,
        JsonNode payload) {

}
