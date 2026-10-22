package com.ridehail.driverservice.service;

import java.util.Optional;

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
import static org.mockito.Mockito.anyString;
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
        driver.setId("drv-test");
        driver.setStatus(DriverStatus.AVAILABLE);
        when(drivers.findById("drv-test")).thenReturn(Optional.of(driver));
        when(drivers.goOnline("drv-test")).thenReturn(1);
        when(drivers.releaseDriver("drv-test")).thenReturn(1);
        when(drivers.completeTrip("drv-test")).thenReturn(1);
        var location = mock(DriverLocation.class);
        when(location.getLatitude()).thenReturn(21.0);
        when(location.getLongitude()).thenReturn(105.0);
        when(locations.findById("drv-test")).thenReturn(Optional.of(location));
        switch (transition) {
            case "online" -> service.goOnline("drv-test");
            case "release" -> service.releaseDriver("drv-test");
            case "complete" -> service.completeTrip("drv-test");
        }
        verify(geo).updateLocation("drv-test", 21, 105);
    }

    @ParameterizedTest
    @EnumSource(DriverStatus.class)
    void locationUpdatesIndexOnlyAvailableDrivers(DriverStatus status) {
        var driver = new Driver();
        driver.setId("drv-test");
        driver.setStatus(status);
        when(drivers.findByIdForLocationUpdate("drv-test")).thenReturn(Optional.of(driver));
        var request = new LocationUpdateRequest();
        request.setLatitude(21.0);
        request.setLongitude(105.0);
        service.updateLocation("drv-test", request);
        verify(locations).upsert("drv-test", 21, 105);
        if (status == DriverStatus.AVAILABLE) {
            verify(geo).updateLocation("drv-test", 21, 105);
        }
        else {
            verify(geo).removeDriver("drv-test");
            verify(geo, never()).updateLocation(anyString(), anyDouble(), anyDouble());
        }
    }

    @Test
    void reserveDistinguishesMissingDriversFromConflicts() {
        var request = new ReserveDriverRequest();
        request.setTripId("trip");
        request.setReservationId("reservation");
        when(drivers.existsById("missing")).thenReturn(false);
        assertThrows(DriverNotFoundException.class, () -> service.reserveDriver("missing", request));
        when(drivers.existsById("busy")).thenReturn(true);
        assertThrows(DriverConflictException.class, () -> service.reserveDriver("busy", request));
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
