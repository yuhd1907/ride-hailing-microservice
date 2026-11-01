package com.ridehail.paymentservice.simulation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class FaultInjectorTest {

    @Test
    void failsExactlyTheRequestedNumberOfTimes() {
        FaultInjector injector = new FaultInjector();
        injector.failNext(2);

        assertThrows(SimulatedFailureException.class, () -> injector.beforeExternalCall("gateway"));
        assertThrows(SimulatedFailureException.class, () -> injector.beforeExternalCall("gateway"));
        assertDoesNotThrow(() -> injector.beforeExternalCall("gateway"));
        assertEquals(0, injector.remaining());
    }

    @Test
    void resetStopsPendingFailures() {
        FaultInjector injector = new FaultInjector();
        injector.failNext(5);
        injector.reset();

        assertDoesNotThrow(() -> injector.beforeExternalCall("gateway"));
    }

}
