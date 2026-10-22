package com.ridehail.driverservice.service;

import java.util.List;

import com.ridehail.driverservice.dto.response.NearbyDriverResult;

public interface DriverLocationRedisService {

    void updateLocation(String driverId, double latitude, double longitude);

    List<NearbyDriverResult> findNearbyDrivers(double latitude, double longitude, double radiusKm);

    void removeDriver(String driverId);

}
