package com.ridehail.paymentservice.service.impl;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.ridehail.paymentservice.config.exception.ForbiddenException;
import com.ridehail.paymentservice.dto.event.PaymentFailedPayload;
import com.ridehail.paymentservice.dto.event.PaymentSucceededPayload;
import com.ridehail.paymentservice.dto.event.TripCompletedPayload;
import com.ridehail.paymentservice.entity.Payment;
import com.ridehail.paymentservice.entity.PaymentFailureReason;
import com.ridehail.paymentservice.entity.PaymentStatus;
import com.ridehail.paymentservice.entity.ProcessedEvent;
import com.ridehail.paymentservice.messaging.EventEnvelope;
import com.ridehail.paymentservice.messaging.EventTypes;
import com.ridehail.paymentservice.messaging.OutboxWriter;
import com.ridehail.paymentservice.repository.PaymentRepository;
import com.ridehail.paymentservice.repository.ProcessedEventRepository;
import com.ridehail.paymentservice.simulation.FaultInjector;
import com.ridehail.paymentservice.simulation.PaymentGatewaySimulator;
import com.ridehail.paymentservice.simulation.SimulatedFailureException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PaymentServiceImplTest {

    private static final UUID TRIP_ID = UUID.fromString("5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b");

    private static final UUID RIDER_ID = UUID.fromString("26a7f8fe-79a8-49ea-a46a-9529e5c3e381");

    private static final UUID DRIVER_ID = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");

    @Mock
    private PaymentRepository paymentRepository;

    @Mock
    private ProcessedEventRepository processedEventRepository;

    @Mock
    private OutboxWriter outboxWriter;

    private FaultInjector faultInjector;

    private PaymentServiceImpl service;

    @BeforeEach
    void setUp() {
        this.faultInjector = new FaultInjector();
        this.service = new PaymentServiceImpl(this.paymentRepository, this.processedEventRepository, this.outboxWriter,
                new PaymentGatewaySimulator(new BigDecimal("2000000")), this.faultInjector);
    }

    @Test
    void chargeWithinLimitSucceedsAndQueuesPaymentSucceeded() {
        EventEnvelope envelope = envelope();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(false);
        when(this.paymentRepository.findByIdempotencyKey(TRIP_ID)).thenReturn(Optional.empty());
        when(this.paymentRepository.saveAndFlush(any(Payment.class))).thenAnswer((call) -> call.getArgument(0));

        this.service.handleTripCompleted(envelope, payload("125000.00"));

        ArgumentCaptor<Payment> saved = ArgumentCaptor.forClass(Payment.class);
        verify(this.paymentRepository).saveAndFlush(saved.capture());
        assertEquals(PaymentStatus.SUCCESS, saved.getValue().getStatus());
        assertEquals(TRIP_ID, saved.getValue().getIdempotencyKey());
        verify(this.processedEventRepository).save(any(ProcessedEvent.class));
        ArgumentCaptor<Object> event = ArgumentCaptor.forClass(Object.class);
        verify(this.outboxWriter).enqueue(eq(EventTypes.PAYMENT_SUCCEEDED), eq(TRIP_ID), eq("corr-1"), event.capture());
        PaymentSucceededPayload succeeded = assertInstanceOf(PaymentSucceededPayload.class, event.getValue());
        assertEquals(new BigDecimal("125000.00"), succeeded.amount());
    }

    @Test
    void chargeAboveLimitFailsWithInsufficientFundsAndQueuesPaymentFailed() {
        EventEnvelope envelope = envelope();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(false);
        when(this.paymentRepository.findByIdempotencyKey(TRIP_ID)).thenReturn(Optional.empty());
        when(this.paymentRepository.saveAndFlush(any(Payment.class))).thenAnswer((call) -> call.getArgument(0));

        this.service.handleTripCompleted(envelope, payload("5000000.00"));

        ArgumentCaptor<Object> event = ArgumentCaptor.forClass(Object.class);
        verify(this.outboxWriter).enqueue(eq(EventTypes.PAYMENT_FAILED), eq(TRIP_ID), eq("corr-1"), event.capture());
        PaymentFailedPayload failed = assertInstanceOf(PaymentFailedPayload.class, event.getValue());
        assertEquals(PaymentFailureReason.INSUFFICIENT_FUNDS, failed.reason());
    }

    @Test
    void duplicateEventIdIsIgnored() {
        EventEnvelope envelope = envelope();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(true);

        this.service.handleTripCompleted(envelope, payload("125000.00"));

        verifyNoInteractions(this.paymentRepository, this.outboxWriter);
        verify(this.processedEventRepository, never()).save(any());
    }

    @Test
    void secondEventForSameTripDoesNotChargeAgain() {
        EventEnvelope envelope = envelope();
        Payment existing = new Payment(TRIP_ID, RIDER_ID, DRIVER_ID, new BigDecimal("125000.00"), TRIP_ID, "corr-0");
        existing.markSucceeded();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(false);
        when(this.paymentRepository.findByIdempotencyKey(TRIP_ID)).thenReturn(Optional.of(existing));

        this.service.handleTripCompleted(envelope, payload("125000.00"));

        verify(this.paymentRepository, never()).saveAndFlush(any());
        verify(this.processedEventRepository).save(any(ProcessedEvent.class));
        verifyNoInteractions(this.outboxWriter);
    }

    @Test
    void injectedFaultFailsBeforeAnythingIsWritten() {
        EventEnvelope envelope = envelope();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(false);
        when(this.paymentRepository.findByIdempotencyKey(TRIP_ID)).thenReturn(Optional.empty());
        this.faultInjector.failNext(1);

        assertThrows(SimulatedFailureException.class,
                () -> this.service.handleTripCompleted(envelope, payload("125000.00")));

        verify(this.paymentRepository, never()).saveAndFlush(any());
        verify(this.processedEventRepository, never()).save(any());
        verifyNoInteractions(this.outboxWriter);
        assertEquals(0, this.faultInjector.remaining());
    }

    @Test
    void riderCannotReadPaymentOfAnotherRider() {
        UUID paymentId = UUID.randomUUID();
        Payment payment = new Payment(TRIP_ID, RIDER_ID, DRIVER_ID, new BigDecimal("125000.00"), TRIP_ID, "corr-1");
        when(this.paymentRepository.findById(paymentId)).thenReturn(Optional.of(payment));

        assertThrows(ForbiddenException.class, () -> this.service.getPayment(paymentId, UUID.randomUUID()));
    }

    private static EventEnvelope envelope() {
        return new EventEnvelope(UUID.randomUUID(), EventTypes.TRIP_COMPLETED, "corr-1", Instant.now(),
                JsonNodeFactory.instance.objectNode());
    }

    private static TripCompletedPayload payload(String amount) {
        return new TripCompletedPayload(TRIP_ID, RIDER_ID, null, DRIVER_ID, new BigDecimal(amount), Instant.now());
    }

}
