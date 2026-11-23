package com.ridehail.notificationservice.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.ridehail.notificationservice.dto.NotificationDraft;
import com.ridehail.notificationservice.dto.event.DriverAssignedPayload;
import com.ridehail.notificationservice.dto.event.PaymentFailedPayload;
import com.ridehail.notificationservice.dto.event.PaymentSucceededPayload;
import com.ridehail.notificationservice.dto.event.TripCompensatedPayload;
import com.ridehail.notificationservice.dto.event.TripFailedPayload;
import com.ridehail.notificationservice.entity.RecipientRole;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NotificationMessageFactoryTest {

    private static final UUID TRIP_ID = UUID.fromString("5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b");

    private static final UUID RIDER_ID = UUID.fromString("26a7f8fe-79a8-49ea-a46a-9529e5c3e381");

    private static final UUID DRIVER_ID = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");

    private final NotificationMessageFactory factory = new NotificationMessageFactory();

    @Test
    void noAvailableDriversNotifiesOnlyThePassenger() {
        List<NotificationDraft> drafts = this.factory
            .tripFailed(new TripFailedPayload(TRIP_ID, RIDER_ID, "NO_AVAILABLE_DRIVERS", Instant.now()));
        assertEquals(1, drafts.size());
        assertEquals(RIDER_ID, drafts.get(0).recipientId());
        assertEquals(RecipientRole.PASSENGER, drafts.get(0).recipientRole());
        assertEquals("TRIP_FAILED", drafts.get(0).type());
        assertTrue(drafts.get(0).content().contains("không còn tài xế"));
    }

    @Test
    void driverAssignedNotifiesPassengerAndDriver() {
        List<NotificationDraft> drafts = this.factory
            .driverAssigned(new DriverAssignedPayload(TRIP_ID, null, RIDER_ID, DRIVER_ID, Instant.now()));

        assertEquals(2, drafts.size());
        assertEquals(RIDER_ID, drafts.get(0).recipientId());
        assertEquals(RecipientRole.PASSENGER, drafts.get(0).recipientRole());
        assertEquals(DRIVER_ID, drafts.get(1).recipientId());
        assertEquals(RecipientRole.DRIVER, drafts.get(1).recipientRole());
    }

    @Test
    void paymentSucceededShowsAmountInVnd() {
        List<NotificationDraft> drafts = this.factory.paymentSucceeded(new PaymentSucceededPayload(UUID.randomUUID(),
                TRIP_ID, RIDER_ID, DRIVER_ID, new BigDecimal("125000.00"), Instant.now()));

        assertEquals(1, drafts.size());
        assertEquals(NotificationMessageFactory.TYPE_PAYMENT_SUCCEEDED, drafts.get(0).type());
        assertTrue(drafts.get(0).content().contains("125.000 VND"), drafts.get(0).content());
    }

    @Test
    void paymentFailedExplainsReason() {
        List<NotificationDraft> drafts = this.factory.paymentFailed(new PaymentFailedPayload(UUID.randomUUID(), TRIP_ID,
                RIDER_ID, DRIVER_ID, new BigDecimal("5000000"), "INSUFFICIENT_FUNDS", Instant.now()));

        assertTrue(drafts.get(0).content().contains("số dư không đủ"), drafts.get(0).content());
    }

    @Test
    void tripCompensatedWithoutDriverNotifiesPassengerOnly() {
        List<NotificationDraft> drafts = this.factory.tripCompensated(
                new TripCompensatedPayload(TRIP_ID, RIDER_ID, null, null, "PAYMENT_DECLINED", Instant.now()));

        assertEquals(1, drafts.size());
        assertEquals(RecipientRole.PASSENGER, drafts.get(0).recipientRole());
    }

}
