package com.ridehail.driverservice.service;

import java.util.List;

import com.ridehail.driverservice.dto.request.LocationUpdateRequest;
import com.ridehail.driverservice.dto.request.ReserveDriverRequest;
import com.ridehail.driverservice.dto.response.DriverResponse;

public interface DriverService {

    DriverResponse getDriverById(String driverId);

    void updateLocation(String driverId, LocationUpdateRequest request);

    List<DriverResponse> findAvailableNearby(double latitude, double longitude, double radiusKm);

    DriverResponse reserveDriver(String driverId, ReserveDriverRequest request);

    DriverResponse releaseDriver(String driverId);

    DriverResponse startTrip(String driverId);

    DriverResponse completeTrip(String driverId);

    DriverResponse goOnline(String driverId);

    DriverResponse goOffline(String driverId);

    String getInstanceId();

}
