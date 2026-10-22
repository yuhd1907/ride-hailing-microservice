package com.ridehail.driverservice.dto.request;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

/**
 * DTO cập nhật vị trí GPS tài xế (gửi lên Redis GEO)
 */
public class LocationUpdateRequest {

    @NotNull(message = "Vĩ độ (latitude) không được để trống")
    @DecimalMin(value = "-85.05112878", message = "Vĩ độ phải >= -85.05112878 (Redis GEO)")
    @DecimalMax(value = "85.05112878", message = "Vĩ độ phải <= 85.05112878 (Redis GEO)")
    private Double latitude;

    @NotNull(message = "Kinh độ (longitude) không được để trống")
    @DecimalMin(value = "-180.0", message = "Kinh độ phải >= -180.0")
    @DecimalMax(value = "180.0", message = "Kinh độ phải <= 180.0")
    private Double longitude;

    // === Getters & Setters ===
    public Double getLatitude() {
        return latitude;
    }

    public void setLatitude(Double latitude) {
        this.latitude = latitude;
    }

    public Double getLongitude() {
        return longitude;
    }

    public void setLongitude(Double longitude) {
        this.longitude = longitude;
    }

}
