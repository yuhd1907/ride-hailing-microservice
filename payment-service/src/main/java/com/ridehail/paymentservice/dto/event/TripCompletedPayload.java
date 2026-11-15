package com.ridehail.paymentservice.dto.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/**
 * Payload của event trip.completed do Trip Service publish.
 * <p>
 * Nhận cả {@code riderId} (theo event-schema) và {@code passengerId} (tên Trip Service
 * đang dùng trong database) để hai bên không phụ thuộc thời điểm đổi tên.
 */
public record TripCompletedPayload(@NotNull UUID tripId, UUID riderId, UUID passengerId, @NotNull UUID driverId,
        @NotNull @Positive @Digits(integer = 10, fraction = 2) BigDecimal fareAmount, Instant completedAt) {

    public UUID resolvedRiderId() {
        return (this.riderId != null) ? this.riderId : this.passengerId;
    }

}
