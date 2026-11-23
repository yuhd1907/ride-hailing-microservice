package com.ridehail.paymentservice.dto.event;

import java.math.BigDecimal;
import java.util.UUID;

import com.ridehail.paymentservice.entity.PaymentMethod;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/**
 * Payload của trip.requested mà Payment cần để khoá tiền. Các field khác (pickup,
 * destination, vehicleType...) bị bỏ qua.
 */
public record TripRequestedPayload(@NotNull UUID tripId, UUID riderId, UUID passengerId,
        @NotNull @Positive @Digits(integer = 10, fraction = 2) BigDecimal fareAmount, String paymentMethod) {

    public UUID resolvedRiderId() {
        return (this.riderId != null) ? this.riderId : this.passengerId;
    }

    public PaymentMethod resolvedMethod() {
        return PaymentMethods.resolve(this.paymentMethod);
    }

}
