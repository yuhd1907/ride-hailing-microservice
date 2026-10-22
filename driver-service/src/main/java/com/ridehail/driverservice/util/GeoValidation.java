package com.ridehail.driverservice.util;

import com.ridehail.driverservice.config.exception.InvalidLocationException;

public final class GeoValidation {

    public static final double MAX_LATITUDE = 85.05112878;

    private GeoValidation() {
    }

    public static void coordinates(double latitude, double longitude) {
        if (!Double.isFinite(latitude) || Math.abs(latitude) > MAX_LATITUDE) {
            throw new InvalidLocationException("Vĩ độ phải nằm trong [-85.05112878, 85.05112878] để lưu Redis GEO");
        }
        if (!Double.isFinite(longitude) || Math.abs(longitude) > 180) {
            throw new InvalidLocationException("Kinh độ phải nằm trong [-180, 180]");
        }
    }

    public static void search(double latitude, double longitude, double radiusKm) {
        coordinates(latitude, longitude);
        if (!Double.isFinite(radiusKm) || radiusKm <= 0) {
            throw new InvalidLocationException("Bán kính phải là số hữu hạn lớn hơn 0");
        }
    }

}
