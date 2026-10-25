package com.ridehail.driverservice.dto.response;

import java.util.UUID;

public final class NearbyDriverResult {

    private final UUID driverId;

    private final double distanceKm;

    public NearbyDriverResult(UUID driverId, double distanceKm) {
        this.driverId = driverId;
        this.distanceKm = distanceKm;
    }

    public UUID getDriverId() {
        return driverId;
    }

    public double getDistanceKm() {
        return distanceKm;
    }

}
