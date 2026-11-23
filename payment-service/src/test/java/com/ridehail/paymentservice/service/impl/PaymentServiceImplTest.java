package com.ridehail.paymentservice.service.impl;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.ridehail.paymentservice.config.exception.ConflictException;
import com.ridehail.paymentservice.config.exception.ForbiddenException;
import com.ridehail.paymentservice.config.exception.ResourceNotFoundException;
import com.ridehail.paymentservice.dto.event.PaymentFailedPayload;
import com.ridehail.paymentservice.dto.event.PaymentSucceededPayload;
import com.ridehail.paymentservice.dto.event.TripCompletedPayload;
import com.ridehail.paymentservice.dto.response.PaymentResponse;
import com.ridehail.paymentservice.entity.Payment;
import com.ridehail.paymentservice.entity.PaymentFailureReason;
import com.ridehail.paymentservice.entity.PaymentMethod;
import com.ridehail.paymentservice.entity.PaymentStatus;
import com.ridehail.paymentservice.entity.ProcessedEvent;
import com.ridehail.paymentservice.messaging.EventEnvelope;
import com.ridehail.paymentservice.messaging.EventTypes;
import com.ridehail.paymentservice.messaging.OutboxWriter;
import com.ridehail.paymentservice.repository.PaymentRepository;
import com.ridehail.paymentservice.repository.ProcessedEventRepository;
import com.ridehail.paymentservice.service.BankService;
import com.ridehail.paymentservice.service.CaptureOutcome;
import com.ridehail.paymentservice.simulation.FaultInjector;
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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PaymentServiceImplTest {

    private static final UUID TRIP_ID = UUID.fromString("5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b");

    private static final UUID RIDER_ID = UUID.fromString("26a7f8fe-79a8-49ea-a46a-9529e5c3e381");

    private static final UUID DRIVER_ID = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");

    private static final BigDecimal FARE = new BigDecimal("125000.00");

    @Mock
    private PaymentRepository paymentRepository;

    @Mock
    private ProcessedEventRepository processedEventRepository;

    @Mock
    private OutboxWriter outboxWriter;

    @Mock
    private BankService bankService;

    private FaultInjector faultInjector;

    private PaymentServiceImpl service;

    @BeforeEach
    void setUp() {
        this.faultInjector = new FaultInjector();
        this.service = new PaymentServiceImpl(this.paymentRepository, this.processedEventRepository, this.outboxWriter,
                this.bankService, this.faultInjector);
    }

    private void newTrip(EventEnvelope envelope) {
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(false);
        when(this.paymentRepository.findByIdempotencyKey(TRIP_ID)).thenReturn(Optional.empty());
    }

    private Payment savedPayment() {
        ArgumentCaptor<Payment> saved = ArgumentCaptor.forClass(Payment.class);
        verify(this.paymentRepository).saveAndFlush(saved.capture());
        return saved.getValue();
    }

    private Object queued(String eventType) {
        ArgumentCaptor<Object> event = ArgumentCaptor.forClass(Object.class);
        verify(this.outboxWriter).enqueue(eq(eventType), eq(TRIP_ID), any(), event.capture());
        return event.getValue();
    }

    private Payment cashPayment() {
        return new Payment(TRIP_ID, RIDER_ID, DRIVER_ID, FARE, TRIP_ID, "corr-1", PaymentMethod.CASH);
    }

    @Test
    void bankTripCapturesAndQueuesPaymentSucceeded() {
        EventEnvelope envelope = envelope();
        newTrip(envelope);
        when(this.bankService.capture(TRIP_ID, RIDER_ID, FARE)).thenReturn(CaptureOutcome.CAPTURED);
        when(this.paymentRepository.saveAndFlush(any(Payment.class))).thenAnswer((call) -> call.getArgument(0));

        this.service.handleTripCompleted(envelope, payload("BANK"));

        Payment payment = savedPayment();
        assertEquals(PaymentStatus.SUCCESS, payment.getStatus());
        assertEquals(PaymentMethod.BANK, payment.getMethod());
        assertEquals(TRIP_ID, payment.getIdempotencyKey());
        verify(this.processedEventRepository).save(any(ProcessedEvent.class));
        PaymentSucceededPayload succeeded = assertInstanceOf(PaymentSucceededPayload.class,
                queued(EventTypes.PAYMENT_SUCCEEDED));
        assertEquals(FARE, succeeded.amount());
        assertEquals(PaymentMethod.BANK, succeeded.paymentMethod());
    }

    @Test
    void bankTripWithoutFundsQueuesPaymentFailed() {
        EventEnvelope envelope = envelope();
        newTrip(envelope);
        when(this.bankService.capture(TRIP_ID, RIDER_ID, FARE)).thenReturn(CaptureOutcome.INSUFFICIENT_FUNDS);
        when(this.paymentRepository.saveAndFlush(any(Payment.class))).thenAnswer((call) -> call.getArgument(0));

        this.service.handleTripCompleted(envelope, payload("BANK"));

        assertEquals(PaymentStatus.FAILED, savedPayment().getStatus());
        PaymentFailedPayload failed = assertInstanceOf(PaymentFailedPayload.class, queued(EventTypes.PAYMENT_FAILED));
        assertEquals(PaymentFailureReason.INSUFFICIENT_FUNDS, failed.reason());
    }

    @Test
    void missingPaymentMethodChargesBank() {
        EventEnvelope envelope = envelope();
        newTrip(envelope);
        when(this.bankService.capture(TRIP_ID, RIDER_ID, FARE)).thenReturn(CaptureOutcome.CAPTURED);
        when(this.paymentRepository.saveAndFlush(any(Payment.class))).thenAnswer((call) -> call.getArgument(0));

        this.service.handleTripCompleted(envelope, payload(null));

        verify(this.bankService).capture(TRIP_ID, RIDER_ID, FARE);
        assertEquals(PaymentMethod.BANK, savedPayment().getMethod());
    }

    @Test
    void cashTripWaitsForDriverConfirmation() {
        EventEnvelope envelope = envelope();
        newTrip(envelope);
        when(this.paymentRepository.saveAndFlush(any(Payment.class))).thenAnswer((call) -> call.getArgument(0));

        this.service.handleTripCompleted(envelope, payload("CASH"));

        Payment payment = savedPayment();
        assertEquals(PaymentStatus.PENDING, payment.getStatus());
        assertEquals(PaymentMethod.CASH, payment.getMethod());
        verify(this.processedEventRepository).save(any(ProcessedEvent.class));
        verifyNoInteractions(this.outboxWriter, this.bankService);
    }

    @Test
    void onlyAssignedDriverConfirmsCashOnce() {
        Payment payment = cashPayment();
        when(this.paymentRepository.findForUpdateByIdempotencyKey(TRIP_ID)).thenReturn(Optional.of(payment));

        assertThrows(ForbiddenException.class, () -> this.service.confirmCash(TRIP_ID, UUID.randomUUID()));

        PaymentResponse confirmed = this.service.confirmCash(TRIP_ID, DRIVER_ID);
        assertEquals(PaymentStatus.SUCCESS, confirmed.status());
        assertEquals(PaymentMethod.CASH, confirmed.method());
        PaymentSucceededPayload succeeded = assertInstanceOf(PaymentSucceededPayload.class,
                queued(EventTypes.PAYMENT_SUCCEEDED));
        assertEquals(PaymentMethod.CASH, succeeded.paymentMethod());

        this.service.confirmCash(TRIP_ID, DRIVER_ID);
        verify(this.outboxWriter, times(1)).enqueue(any(), any(), any(), any());
    }

    @Test
    void confirmCashOnBankPaymentConflicts() {
        Payment bank = new Payment(TRIP_ID, RIDER_ID, DRIVER_ID, FARE, TRIP_ID, "corr-1", PaymentMethod.BANK);
        when(this.paymentRepository.findForUpdateByIdempotencyKey(TRIP_ID)).thenReturn(Optional.of(bank));
        assertThrows(ConflictException.class, () -> this.service.confirmCash(TRIP_ID, DRIVER_ID));

        UUID unknownTrip = UUID.randomUUID();
        when(this.paymentRepository.findForUpdateByIdempotencyKey(unknownTrip)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> this.service.confirmCash(unknownTrip, DRIVER_ID));
    }

    @Test
    void duplicateEventIdIsIgnored() {
        EventEnvelope envelope = envelope();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(true);

        this.service.handleTripCompleted(envelope, payload("BANK"));

        verifyNoInteractions(this.paymentRepository, this.outboxWriter, this.bankService);
        verify(this.processedEventRepository, never()).save(any());
    }

    @Test
    void secondEventForSameTripDoesNotChargeAgain() {
        EventEnvelope envelope = envelope();
        Payment existing = new Payment(TRIP_ID, RIDER_ID, DRIVER_ID, FARE, TRIP_ID, "corr-0", PaymentMethod.BANK);
        existing.markSucceeded();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(false);
        when(this.paymentRepository.findByIdempotencyKey(TRIP_ID)).thenReturn(Optional.of(existing));

        this.service.handleTripCompleted(envelope, payload("BANK"));

        verify(this.paymentRepository, never()).saveAndFlush(any());
        verify(this.processedEventRepository).save(any(ProcessedEvent.class));
        verifyNoInteractions(this.outboxWriter, this.bankService);
    }

    @Test
    void injectedFaultFailsBeforeAnythingIsWritten() {
        EventEnvelope envelope = envelope();
        newTrip(envelope);
        this.faultInjector.failNext(1);

        assertThrows(SimulatedFailureException.class,
                () -> this.service.handleTripCompleted(envelope, payload("BANK")));

        verify(this.paymentRepository, never()).saveAndFlush(any());
        verify(this.processedEventRepository, never()).save(any());
        verifyNoInteractions(this.outboxWriter, this.bankService);
        assertEquals(0, this.faultInjector.remaining());
    }

    @Test
    void riderCannotReadPaymentOfAnotherRider() {
        UUID paymentId = UUID.randomUUID();
        Payment payment = new Payment(TRIP_ID, RIDER_ID, DRIVER_ID, FARE, TRIP_ID, "corr-1", PaymentMethod.BANK);
        when(this.paymentRepository.findById(paymentId)).thenReturn(Optional.of(payment));

        assertThrows(ForbiddenException.class, () -> this.service.getPayment(paymentId, UUID.randomUUID()));
    }

    private static EventEnvelope envelope() {
        return new EventEnvelope(UUID.randomUUID(), EventTypes.TRIP_COMPLETED, "corr-1", Instant.now(),
                JsonNodeFactory.instance.objectNode());
    }

    private static TripCompletedPayload payload(String method) {
        return new TripCompletedPayload(TRIP_ID, RIDER_ID, null, DRIVER_ID, FARE, Instant.now(), method);
    }

}
