package com.ridehail.notificationservice.dto.event;

import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * Payload của event matching.driver_assigned. Nhận cả riderId và passengerId.
 */
public record DriverAssignedPayload(@NotNull UUID tripId, UUID riderId, UUID passengerId, @NotNull UUID driverId,
        Instant assignedAt) {

    public UUID resolvedRiderId() {
        return (this.riderId != null) ? this.riderId : this.passengerId;
    }

}
