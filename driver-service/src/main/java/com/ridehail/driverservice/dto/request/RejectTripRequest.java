package com.ridehail.driverservice.dto.request;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * DTO yêu cầu tài xế từ chối 1 chuyến đã được ghép (dùng bởi Trip Service - TV2)
 */
public class RejectTripRequest {

    @NotNull(message = "tripId không được để trống")
    private UUID tripId;

    // === Getters & Setters ===
    public UUID getTripId() {
        return tripId;
    }

    public void setTripId(UUID tripId) {
        this.tripId = tripId;
    }

}
