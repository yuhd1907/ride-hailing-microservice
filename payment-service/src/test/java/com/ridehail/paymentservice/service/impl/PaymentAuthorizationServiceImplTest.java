package com.ridehail.paymentservice.service.impl;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.ridehail.paymentservice.dto.event.PaymentAuthorizationFailedPayload;
import com.ridehail.paymentservice.dto.event.PaymentAuthorizedPayload;
import com.ridehail.paymentservice.dto.event.TripClosedPayload;
import com.ridehail.paymentservice.dto.event.TripRequestedPayload;
import com.ridehail.paymentservice.entity.ClosedTrip;
import com.ridehail.paymentservice.entity.FundHold;
import com.ridehail.paymentservice.entity.PaymentFailureReason;
import com.ridehail.paymentservice.entity.PaymentMethod;
import com.ridehail.paymentservice.messaging.EventEnvelope;
import com.ridehail.paymentservice.messaging.EventTypes;
import com.ridehail.paymentservice.messaging.InvalidEventException;
import com.ridehail.paymentservice.messaging.OutboxWriter;
import com.ridehail.paymentservice.repository.ClosedTripRepository;
import com.ridehail.paymentservice.repository.ProcessedEventRepository;
import com.ridehail.paymentservice.service.BankService;
import com.ridehail.paymentservice.service.HoldOutcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PaymentAuthorizationServiceImplTest {

    private static final UUID TRIP_ID = UUID.fromString("5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b");

    private static final UUID RIDER_ID = UUID.fromString("26a7f8fe-79a8-49ea-a46a-9529e5c3e381");

    private static final BigDecimal FARE = new BigDecimal("125000.00");

    @Mock
    private BankService bankService;

    @Mock
    private ClosedTripRepository closedTripRepository;

    @Mock
    private ProcessedEventRepository processedEventRepository;

    @Mock
    private OutboxWriter outboxWriter;

    private PaymentAuthorizationServiceImpl service;

    @BeforeEach
    void setUp() {
        this.service = new PaymentAuthorizationServiceImpl(this.bankService, this.closedTripRepository,
                this.processedEventRepository, this.outboxWriter);
    }

    private static EventEnvelope envelope(String type) {
        return new EventEnvelope(UUID.randomUUID(), type, "corr-1", Instant.now(),
                JsonNodeFactory.instance.objectNode());
    }

    private static TripRequestedPayload requested(String method) {
        return new TripRequestedPayload(TRIP_ID, RIDER_ID, null, FARE, method);
    }

    private Object queued(String eventType) {
        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(this.outboxWriter).enqueue(eq(eventType), eq(TRIP_ID), eq("corr-1"), payload.capture());
        return payload.getValue();
    }

    @Test
    void bankTripWithFundsPublishesAuthorizedWithHold() {
        FundHold hold = new FundHold(TRIP_ID, RIDER_ID, FARE, Instant.now().plusSeconds(60));
        when(this.bankService.hold(TRIP_ID, RIDER_ID, FARE))
            .thenReturn(new HoldOutcome(HoldOutcome.Decision.HELD, hold));

        this.service.handleTripRequested(envelope(EventTypes.TRIP_REQUESTED), requested("BANK"));

        PaymentAuthorizedPayload authorized = assertInstanceOf(PaymentAuthorizedPayload.class,
                queued(EventTypes.PAYMENT_AUTHORIZED));
        assertEquals(PaymentMethod.BANK, authorized.paymentMethod());
        assertEquals(hold.getId(), authorized.holdId());
        assertEquals(FARE, authorized.amount());
        assertEquals(RIDER_ID, authorized.riderId());
        verify(this.processedEventRepository).save(any());
    }

    @Test
    void bankTripWithoutFundsPublishesAuthorizationFailed() {
        when(this.bankService.hold(TRIP_ID, RIDER_ID, FARE))
            .thenReturn(new HoldOutcome(HoldOutcome.Decision.INSUFFICIENT_FUNDS, null));

        this.service.handleTripRequested(envelope(EventTypes.TRIP_REQUESTED), requested("BANK"));

        PaymentAuthorizationFailedPayload failed = assertInstanceOf(PaymentAuthorizationFailedPayload.class,
                queued(EventTypes.PAYMENT_AUTHORIZATION_FAILED));
        assertEquals(PaymentFailureReason.INSUFFICIENT_FUNDS, failed.reason());
        assertEquals(FARE, failed.amount());
    }

    @Test
    void missingPaymentMethodIsTreatedAsBank() {
        when(this.bankService.hold(TRIP_ID, RIDER_ID, FARE))
            .thenReturn(new HoldOutcome(HoldOutcome.Decision.INSUFFICIENT_FUNDS, null));

        this.service.handleTripRequested(envelope(EventTypes.TRIP_REQUESTED), requested(null));

        verify(this.bankService).hold(TRIP_ID, RIDER_ID, FARE);
    }

    @Test
    void cashTripIsAuthorizedWithoutHold() {
        this.service.handleTripRequested(envelope(EventTypes.TRIP_REQUESTED), requested("CASH"));

        verifyNoInteractions(this.bankService);
        PaymentAuthorizedPayload authorized = assertInstanceOf(PaymentAuthorizedPayload.class,
                queued(EventTypes.PAYMENT_AUTHORIZED));
        assertEquals(PaymentMethod.CASH, authorized.paymentMethod());
        assertNull(authorized.holdId());
    }

    @Test
    void unknownPaymentMethodIsInvalid() {
        assertThrows(InvalidEventException.class,
                () -> this.service.handleTripRequested(envelope(EventTypes.TRIP_REQUESTED), requested("CARD")));
        verifyNoInteractions(this.bankService, this.outboxWriter);
    }

    @Test
    void duplicateTripRequestedDoesNotHoldOrPublishTwice() {
        FundHold hold = new FundHold(TRIP_ID, RIDER_ID, FARE, Instant.now().plusSeconds(60));
        when(this.bankService.hold(TRIP_ID, RIDER_ID, FARE))
            .thenReturn(new HoldOutcome(HoldOutcome.Decision.ALREADY_HELD, hold));

        this.service.handleTripRequested(envelope(EventTypes.TRIP_REQUESTED), requested("BANK"));
        verify(this.outboxWriter, never()).enqueue(any(), any(), any(), any());

        EventEnvelope redelivered = envelope(EventTypes.TRIP_REQUESTED);
        when(this.processedEventRepository.existsById(redelivered.eventId())).thenReturn(true);
        this.service.handleTripRequested(redelivered, requested("BANK"));
        verify(this.bankService).hold(TRIP_ID, RIDER_ID, FARE);
    }

    @Test
    void cancelledBeforeRequestedNeverHolds() {
        when(this.bankService.release(TRIP_ID)).thenReturn(false);
        when(this.closedTripRepository.existsById(TRIP_ID)).thenReturn(false, true);

        this.service.handleTripClosed(envelope(EventTypes.TRIP_CANCELLED),
                new TripClosedPayload(TRIP_ID, RIDER_ID, null));
        ArgumentCaptor<ClosedTrip> closed = ArgumentCaptor.forClass(ClosedTrip.class);
        verify(this.closedTripRepository).save(closed.capture());
        assertEquals(EventTypes.TRIP_CANCELLED, closed.getValue().getReason());

        this.service.handleTripRequested(envelope(EventTypes.TRIP_REQUESTED), requested("BANK"));
        verify(this.bankService, never()).hold(any(), any(), any());
        verify(this.outboxWriter, never()).enqueue(any(), any(), any(), any());
    }

    @Test
    void closingTripWithHoldReleasesIt() {
        when(this.bankService.release(TRIP_ID)).thenReturn(true);

        this.service.handleTripClosed(envelope(EventTypes.TRIP_FAILED),
                new TripClosedPayload(TRIP_ID, RIDER_ID, "NO_AVAILABLE_DRIVERS"));

        verify(this.closedTripRepository, never()).save(any());
        verify(this.processedEventRepository).save(any());
    }

}
