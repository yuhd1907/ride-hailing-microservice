package com.ridehail.paymentservice.controller;

import com.ridehail.paymentservice.messaging.DeadLetterQueueManager;
import com.ridehail.paymentservice.repository.OutboxEventRepository;
import com.ridehail.paymentservice.service.BankService;
import com.ridehail.paymentservice.service.PaymentService;
import com.ridehail.paymentservice.simulation.FaultInjector;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(InternalPaymentController.class)
class InternalPaymentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PaymentService paymentService;

    @MockBean
    private FaultInjector faultInjector;

    @MockBean
    private DeadLetterQueueManager deadLetterQueueManager;

    @MockBean
    private OutboxEventRepository outboxEventRepository;

    @MockBean
    private BankService bankService;

    @Test
    void deadLetterQueueDefaultsToTripCompleted() throws Exception {
        when(this.deadLetterQueueManager.countMessages("payment-service.trip.completed.dlq")).thenReturn(2L);

        this.mockMvc.perform(get("/internal/payments/dlq"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.queue").value("payment-service.trip.completed.dlq"))
            .andExpect(jsonPath("$.messages").value(2));
    }

    @Test
    void deadLetterQueueCoversEverySubscribedEvent() throws Exception {
        when(this.deadLetterQueueManager.countMessages("payment-service.trip.requested.dlq")).thenReturn(3L);

        this.mockMvc.perform(get("/internal/payments/dlq").param("eventType", "trip.requested"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.queue").value("payment-service.trip.requested.dlq"))
            .andExpect(jsonPath("$.messages").value(3));

        this.mockMvc.perform(post("/internal/payments/dlq/replay").param("eventType", "trip.cancelled"))
            .andExpect(status().isOk());
        verify(this.deadLetterQueueManager).replay("payment-service.trip.cancelled.dlq",
                "payment-service.trip.cancelled", 100);
    }

    @Test
    void deadLetterQueueRejectsUnknownEventType() throws Exception {
        this.mockMvc.perform(get("/internal/payments/dlq").param("eventType", "payment.succeeded"))
            .andExpect(status().isBadRequest());
        verify(this.deadLetterQueueManager, never()).countMessages(anyString());
    }

}
