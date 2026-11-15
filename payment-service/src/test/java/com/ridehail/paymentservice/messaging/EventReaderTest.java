package com.ridehail.paymentservice.messaging;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.ridehail.paymentservice.dto.event.TripCompletedPayload;
import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EventReaderTest {

    private static final String TRIP_ID = "5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

    private static final String RIDER_ID = "26a7f8fe-79a8-49ea-a46a-9529e5c3e381";

    private static final String DRIVER_ID = "fd699acc-6544-44a9-9634-5396060c61b8";

    private ValidatorFactory validatorFactory;

    private EventReader reader;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = JsonMapper.builder()
            .findAndAddModules()
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .build();
        this.validatorFactory = Validation.buildDefaultValidatorFactory();
        this.reader = new EventReader(objectMapper, this.validatorFactory.getValidator());
    }

    @AfterEach
    void tearDown() {
        this.validatorFactory.close();
    }

    @Test
    void validTripCompletedIsParsed() {
        String eventId = UUID.randomUUID().toString();
        Message message = message(
                envelope(eventId, "trip.completed", "\"corr-1\"",
                        "{\"tripId\":\"" + TRIP_ID + "\",\"riderId\":\"" + RIDER_ID + "\",\"driverId\":\"" + DRIVER_ID
                                + "\",\"fareAmount\":125000.00,\"completedAt\":\"2026-10-18T09:30:00Z\",\"extra\":1}"),
                null);

        EventEnvelope envelope = this.reader.readEnvelope(message, EventTypes.TRIP_COMPLETED);
        TripCompletedPayload payload = this.reader.readPayload(envelope, TripCompletedPayload.class);

        assertEquals(UUID.fromString(eventId), envelope.eventId());
        assertEquals("corr-1", envelope.correlationId());
        assertEquals(UUID.fromString(TRIP_ID), payload.tripId());
        assertEquals(UUID.fromString(RIDER_ID), payload.resolvedRiderId());
        assertEquals(0, payload.fareAmount().compareTo(new java.math.BigDecimal("125000")));
    }

    @Test
    void passengerIdIsAcceptedAsRiderAndCorrelationFallsBackToAmqpProperty() {
        Message message = message(envelope(UUID.randomUUID().toString(), "trip.completed", "null",
                "{\"tripId\":\"" + TRIP_ID + "\",\"passengerId\":\"" + RIDER_ID + "\",\"driverId\":\"" + DRIVER_ID
                        + "\",\"fareAmount\":50000}"),
                "amqp-corr");

        EventEnvelope envelope = this.reader.readEnvelope(message, EventTypes.TRIP_COMPLETED);
        TripCompletedPayload payload = this.reader.readPayload(envelope, TripCompletedPayload.class);

        assertEquals("amqp-corr", envelope.correlationId());
        assertEquals(UUID.fromString(RIDER_ID), payload.resolvedRiderId());
    }

    @Test
    void malformedJsonIsRejected() {
        Message message = message("{not json", null);

        assertThrows(InvalidEventException.class, () -> this.reader.readEnvelope(message, EventTypes.TRIP_COMPLETED));
    }

    @Test
    void unexpectedEventTypeIsRejected() {
        Message message = message(envelope(UUID.randomUUID().toString(), "payment.succeeded", "\"c\"", "{}"), null);

        assertThrows(InvalidEventException.class, () -> this.reader.readEnvelope(message, EventTypes.TRIP_COMPLETED));
    }

    @Test
    void missingFareAmountIsRejectedWithFieldName() {
        Message message = message(envelope(UUID.randomUUID().toString(), "trip.completed", "\"c\"",
                "{\"tripId\":\"" + TRIP_ID + "\",\"riderId\":\"" + RIDER_ID + "\",\"driverId\":\"" + DRIVER_ID + "\"}"),
                null);
        EventEnvelope envelope = this.reader.readEnvelope(message, EventTypes.TRIP_COMPLETED);

        InvalidEventException error = assertThrows(InvalidEventException.class,
                () -> this.reader.readPayload(envelope, TripCompletedPayload.class));
        assertTrue(error.getMessage().contains("fareAmount"));
    }

    private static String envelope(String eventId, String eventType, String correlationJson, String payloadJson) {
        return "{\"eventId\":\"" + eventId + "\",\"eventType\":\"" + eventType + "\",\"correlationId\":"
                + correlationJson + ",\"occurredAt\":\"2026-10-18T09:30:00Z\",\"payload\":" + payloadJson + "}";
    }

    private static Message message(String body, String correlationId) {
        MessageProperties properties = new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        if (correlationId != null) {
            properties.setCorrelationId(correlationId);
        }
        return new Message(body.getBytes(StandardCharsets.UTF_8), properties);
    }

}
