package com.ridehail.driverservice.service;

import java.util.List;
import java.util.UUID;

import com.ridehail.driverservice.dto.response.NearbyDriverResult;

public interface DriverLocationRedisService {

    void updateLocation(UUID driverId, double latitude, double longitude);

    List<NearbyDriverResult> findNearbyDrivers(double latitude, double longitude, double radiusKm);

    void removeDriver(UUID driverId);

}
