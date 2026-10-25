package com.ridehail.driverservice.dto.request;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * DTO yêu cầu giữ tài xế cho 1 chuyến xe (dùng bởi Matching Service - TV2)
 */
public class ReserveDriverRequest {

    @NotNull(message = "tripId không được để trống")
    private UUID tripId;

    @NotNull(message = "reservationId không được để trống")
    private UUID reservationId;

    // === Getters & Setters ===
    public UUID getTripId() {
        return tripId;
    }

    public void setTripId(UUID tripId) {
        this.tripId = tripId;
    }

    public UUID getReservationId() {
        return reservationId;
    }

    public void setReservationId(UUID reservationId) {
        this.reservationId = reservationId;
    }

}
