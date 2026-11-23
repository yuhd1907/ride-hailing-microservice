package com.ridehail.paymentservice.dto.event;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * Payload dùng chung cho trip.cancelled và trip.failed: Payment chỉ cần biết chuyến nào
 * đã kết thúc mà không hoàn thành để mở khoá tiền.
 */
public record TripClosedPayload(@NotNull UUID tripId, UUID riderId, String reason) {
}
