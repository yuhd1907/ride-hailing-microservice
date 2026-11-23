package com.ridehail.driverservice.service;

import java.util.List;
import java.util.UUID;

import com.ridehail.driverservice.dto.request.CreateDriverProfileRequest;
import com.ridehail.driverservice.dto.request.LocationUpdateRequest;
import com.ridehail.driverservice.dto.request.ReserveDriverRequest;
import com.ridehail.driverservice.dto.response.DriverResponse;

public interface DriverService {

    DriverResponse createDriverProfile(UUID driverId, CreateDriverProfileRequest request, String fallbackFullName,
            String fallbackPhone);

    DriverResponse getDriverById(UUID driverId);

    void updateLocation(UUID driverId, LocationUpdateRequest request);

    List<DriverResponse> findAvailableNearby(double latitude, double longitude, double radiusKm);

    DriverResponse reserveDriver(UUID driverId, ReserveDriverRequest request);

    DriverResponse releaseDriver(UUID driverId);

    DriverResponse releaseDriver(UUID driverId, UUID tripId);

    DriverResponse rejectTrip(UUID driverId, UUID tripId);

    DriverResponse startTrip(UUID driverId);

    DriverResponse startTrip(UUID driverId, UUID tripId);

    DriverResponse completeTrip(UUID driverId);

    DriverResponse completeTrip(UUID driverId, UUID tripId);

    DriverResponse goOnline(UUID driverId);

    DriverResponse goOffline(UUID driverId);

    int releaseExpiredReservations();

    String getInstanceId();

}
