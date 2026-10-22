package com.ridehail.driverservice.dto.response;

public final class NearbyDriverResult {

    private final String driverId;

    private final double distanceKm;

    public NearbyDriverResult(String driverId, double distanceKm) {
        this.driverId = driverId;
        this.distanceKm = distanceKm;
    }

    public String getDriverId() {
        return driverId;
    }

    public double getDistanceKm() {
        return distanceKm;
    }

}
