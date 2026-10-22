package com.ridehail.driverservice.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * DTO yêu cầu giữ tài xế cho 1 chuyến xe (dùng bởi Matching Service - TV2)
 */
public class ReserveDriverRequest {

    @NotBlank(message = "tripId không được để trống")
    @Size(max = 36, message = "tripId tối đa 36 ký tự")
    private String tripId;

    @NotBlank(message = "reservationId không được để trống")
    @Size(max = 36, message = "reservationId tối đa 36 ký tự")
    private String reservationId;

    // === Getters & Setters ===
    public String getTripId() {
        return tripId;
    }

    public void setTripId(String tripId) {
        this.tripId = tripId;
    }

    public String getReservationId() {
        return reservationId;
    }

    public void setReservationId(String reservationId) {
        this.reservationId = reservationId;
    }

}
