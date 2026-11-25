package com.ridehail.driverservice.dto.response;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Vị trí GPS gần nhất của tài xế (bảng driver_locations). stale = quá thời hạn cập nhật.
 */
public record DriverLocationResponse(UUID driverId, double latitude, double longitude, LocalDateTime updatedAt,
        boolean stale) {
}
