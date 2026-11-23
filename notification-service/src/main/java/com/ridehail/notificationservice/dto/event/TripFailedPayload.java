package com.ridehail.notificationservice.dto.event;

import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record TripFailedPayload(@NotNull UUID tripId, @NotNull UUID riderId, @NotBlank String reason,
        @NotNull Instant failedAt) {
}
