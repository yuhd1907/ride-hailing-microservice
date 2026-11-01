package com.ridehail.notificationservice.dto.event;

import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * Payload của event trip.compensated: Trip Service đã hoàn tác chuyến sau khi thanh toán
 * thất bại. Nhận cả riderId và passengerId.
 */
public record TripCompensatedPayload(@NotNull UUID tripId, UUID riderId, UUID passengerId, UUID driverId, String reason,
        Instant compensatedAt) {

    public UUID resolvedRiderId() {
        return (this.riderId != null) ? this.riderId : this.passengerId;
    }

}
