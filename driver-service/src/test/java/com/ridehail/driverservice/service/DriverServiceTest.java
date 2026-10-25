package com.ridehail.driverservice.service;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.MDC;

import com.ridehail.driverservice.config.exception.DriverConflictException;
import com.ridehail.driverservice.config.exception.DriverNotFoundException;
import com.ridehail.driverservice.config.exception.InvalidLocationException;
import com.ridehail.driverservice.dto.request.LocationUpdateRequest;
import com.ridehail.driverservice.dto.request.ReserveDriverRequest;
import com.ridehail.driverservice.entity.Driver;
import com.ridehail.driverservice.entity.DriverLocation;
import com.ridehail.driverservice.entity.DriverStatus;
import com.ridehail.driverservice.mapper.DriverMapper;
import com.ridehail.driverservice.repository.DriverLocationRepository;
import com.ridehail.driverservice.repository.DriverRepository;
import com.ridehail.driverservice.service.impl.DriverServiceImpl;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.anyDouble;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DriverServiceTest {

    private DriverRepository drivers;

    private DriverLocationRepository locations;

    private DriverLocationRedisService geo;

    private DriverService service;

    @BeforeEach
    void setup() {
        drivers = mock(DriverRepository.class);
        locations = mock(DriverLocationRepository.class);
        geo = mock(DriverLocationRedisService.class);
        service = new DriverServiceImpl(drivers, geo, locations, new DriverMapper(), "driver-test");
    }

    @AfterEach
    void clearContext() {
        MDC.clear();
    }

    @ParameterizedTest
    @ValueSource(strings = { "online", "release", "complete" })
    void becomingAvailableRestoresTheLatestStoredLocation(String transition) {
        var driver = new Driver();
        driver.setId(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"));
        driver.setStatus(DriverStatus.AVAILABLE);
        when(drivers.findById(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"))).thenReturn(Optional.of(driver));
        when(drivers.goOnline(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"))).thenReturn(1);
        when(drivers.releaseDriver(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"))).thenReturn(1);
        when(drivers.completeTrip(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"))).thenReturn(1);
        var location = mock(DriverLocation.class);
        when(location.getLatitude()).thenReturn(21.0);
        when(location.getLongitude()).thenReturn(105.0);
        when(locations.findById(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f")))
            .thenReturn(Optional.of(location));
        switch (transition) {
            case "online" -> service.goOnline(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"));
            case "release" -> service.releaseDriver(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"));
            case "complete" -> service.completeTrip(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"));
        }
        verify(geo).updateLocation(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"), 21, 105);
    }

    @ParameterizedTest
    @EnumSource(DriverStatus.class)
    void locationUpdatesIndexOnlyAvailableDrivers(DriverStatus status) {
        var driver = new Driver();
        driver.setId(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"));
        driver.setStatus(status);
        when(drivers.findByIdForLocationUpdate(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f")))
            .thenReturn(Optional.of(driver));
        var request = new LocationUpdateRequest();
        request.setLatitude(21.0);
        request.setLongitude(105.0);
        service.updateLocation(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"), request);
        verify(locations).upsert(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"), 21, 105);
        if (status == DriverStatus.AVAILABLE) {
            verify(geo).updateLocation(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"), 21, 105);
        }
        else {
            verify(geo).removeDriver(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"));
            verify(geo, never()).updateLocation(any(UUID.class), anyDouble(), anyDouble());
        }
    }

    @Test
    void reserveDistinguishesMissingDriversFromConflicts() {
        var request = new ReserveDriverRequest();
        request.setTripId(UUID.fromString("93d8f465-65ac-491d-a4d0-b29cc65775cd"));
        request.setReservationId(UUID.fromString("734b66d6-cdc0-487a-9e06-32a81246d891"));
        when(drivers.existsById(UUID.fromString("b83ea108-d819-4bb8-b213-986c3a38e0bd"))).thenReturn(false);
        assertThrows(DriverNotFoundException.class,
                () -> service.reserveDriver(UUID.fromString("b83ea108-d819-4bb8-b213-986c3a38e0bd"), request));
        when(drivers.existsById(UUID.fromString("dd2226b7-2535-42ef-a438-638c63b3a981"))).thenReturn(true);
        assertThrows(DriverConflictException.class,
                () -> service.reserveDriver(UUID.fromString("dd2226b7-2535-42ef-a438-638c63b3a981"), request));
        verifyNoInteractions(geo);
    }

    @Test
    void invalidSearchIsRejectedBeforeContactingRedisOrPostgres() {
        assertThrows(InvalidLocationException.class, () -> service.findAvailableNearby(21, 105, 0));
        assertThrows(InvalidLocationException.class, () -> service.findAvailableNearby(Double.NaN, 105, 5));
        assertThrows(InvalidLocationException.class,
                () -> service.findAvailableNearby(21, 105, Double.POSITIVE_INFINITY));
        verifyNoInteractions(drivers, geo, locations);
    }

}
