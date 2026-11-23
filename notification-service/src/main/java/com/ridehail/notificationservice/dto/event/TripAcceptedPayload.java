package com.ridehail.notificationservice.dto.event;

import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * Payload của trip.accepted: tài xế đã nhận chuyến (chuyến bắt đầu ngay).
 */
public record TripAcceptedPayload(@NotNull UUID tripId, @NotNull UUID riderId, UUID driverId, Instant acceptedAt) {
}
