package com.ridehail.driverservice.service;

import java.util.List;
import java.util.UUID;

import com.ridehail.driverservice.dto.request.LocationUpdateRequest;
import com.ridehail.driverservice.dto.request.ReserveDriverRequest;
import com.ridehail.driverservice.dto.response.DriverResponse;

public interface DriverService {

    DriverResponse getDriverById(UUID driverId);

    void updateLocation(UUID driverId, LocationUpdateRequest request);

    List<DriverResponse> findAvailableNearby(double latitude, double longitude, double radiusKm);

    DriverResponse reserveDriver(UUID driverId, ReserveDriverRequest request);

    DriverResponse releaseDriver(UUID driverId);

    DriverResponse startTrip(UUID driverId);

    DriverResponse completeTrip(UUID driverId);

    DriverResponse goOnline(UUID driverId);

    DriverResponse goOffline(UUID driverId);

    String getInstanceId();

}
