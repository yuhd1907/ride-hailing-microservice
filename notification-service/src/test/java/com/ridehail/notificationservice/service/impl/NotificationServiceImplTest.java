package com.ridehail.notificationservice.service.impl;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.ridehail.notificationservice.dto.NotificationDraft;
import com.ridehail.notificationservice.entity.Notification;
import com.ridehail.notificationservice.entity.ProcessedEvent;
import com.ridehail.notificationservice.entity.RecipientRole;
import com.ridehail.notificationservice.messaging.EventEnvelope;
import com.ridehail.notificationservice.messaging.EventTypes;
import com.ridehail.notificationservice.repository.NotificationRepository;
import com.ridehail.notificationservice.repository.ProcessedEventRepository;
import com.ridehail.notificationservice.service.NotificationSender;
import com.ridehail.notificationservice.simulation.FaultInjector;
import com.ridehail.notificationservice.simulation.SimulatedFailureException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NotificationServiceImplTest {

    private static final UUID TRIP_ID = UUID.fromString("5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b");

    @Mock
    private NotificationRepository notificationRepository;

    @Mock
    private ProcessedEventRepository processedEventRepository;

    @Mock
    private NotificationSender notificationSender;

    private FaultInjector faultInjector;

    private NotificationServiceImpl service;

    @BeforeEach
    void setUp() {
        this.faultInjector = new FaultInjector();
        this.service = new NotificationServiceImpl(this.notificationRepository, this.processedEventRepository,
                this.notificationSender, this.faultInjector);
    }

    @Test
    void eachDraftIsStoredSentAndEventIsMarkedProcessed() {
        EventEnvelope envelope = envelope();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(false);
        when(this.notificationRepository.save(any(Notification.class))).thenAnswer((call) -> call.getArgument(0));

        int sent = this.service.notify(envelope, TRIP_ID, drafts());

        assertEquals(2, sent);
        ArgumentCaptor<Notification> saved = ArgumentCaptor.forClass(Notification.class);
        verify(this.notificationRepository, times(2)).save(saved.capture());
        assertEquals(envelope.eventId(), saved.getAllValues().get(0).getEventId());
        assertEquals("corr-1", saved.getAllValues().get(1).getCorrelationId());
        verify(this.notificationSender, times(2)).send(any(Notification.class));
        verify(this.processedEventRepository).save(any(ProcessedEvent.class));
    }

    @Test
    void duplicateEventSendsNothing() {
        EventEnvelope envelope = envelope();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(true);

        assertEquals(0, this.service.notify(envelope, TRIP_ID, drafts()));

        verifyNoInteractions(this.notificationRepository, this.notificationSender);
        verify(this.processedEventRepository, never()).save(any());
    }

    @Test
    void injectedFaultFailsBeforeSending() {
        EventEnvelope envelope = envelope();
        when(this.processedEventRepository.existsById(envelope.eventId())).thenReturn(false);
        this.faultInjector.failNext(1);

        assertThrows(SimulatedFailureException.class, () -> this.service.notify(envelope, TRIP_ID, drafts()));

        verifyNoInteractions(this.notificationRepository, this.notificationSender);
    }

    private static EventEnvelope envelope() {
        return new EventEnvelope(UUID.randomUUID(), EventTypes.DRIVER_ASSIGNED, "corr-1", Instant.now(),
                JsonNodeFactory.instance.objectNode());
    }

    private static List<NotificationDraft> drafts() {
        return List.of(new NotificationDraft(UUID.randomUUID(), RecipientRole.PASSENGER, "DRIVER_ASSIGNED", "a"),
                new NotificationDraft(UUID.randomUUID(), RecipientRole.DRIVER, "DRIVER_ASSIGNED", "b"));
    }

}
