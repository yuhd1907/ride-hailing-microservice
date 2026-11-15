package com.ridehail.driverservice.service;

import java.time.LocalDateTime;
import java.util.List;
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
import com.ridehail.driverservice.config.exception.InvalidStateTransitionException;
import com.ridehail.driverservice.dto.request.CreateDriverProfileRequest;
import com.ridehail.driverservice.dto.request.LocationUpdateRequest;
import com.ridehail.driverservice.dto.request.ReserveDriverRequest;
import com.ridehail.driverservice.dto.response.NearbyDriverResult;
import com.ridehail.driverservice.entity.Driver;
import com.ridehail.driverservice.entity.DriverLocation;
import com.ridehail.driverservice.entity.DriverStatus;
import com.ridehail.driverservice.mapper.DriverMapper;
import com.ridehail.driverservice.repository.DriverLocationRepository;
import com.ridehail.driverservice.repository.DriverRepository;
import com.ridehail.driverservice.service.impl.DriverServiceImpl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
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

    @Test
    void createDriverProfileUsesAccountUuidAndRejectsDuplicates() {
        UUID accountId = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");
        var request = new CreateDriverProfileRequest();
        request.setLicensePlate("30A-12345");
        request.setVehicleType("MOTORCYCLE");

        when(drivers.existsById(accountId)).thenReturn(false);
        when(drivers.existsByLicensePlate("30A-12345")).thenReturn(false);
        when(drivers.existsByPhone("0934567890")).thenReturn(false);
        when(drivers.save(any(Driver.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var created = service.createDriverProfile(accountId, request, "Phạm Minh Đức", "0934567890");
        assertEquals(accountId, created.getId());
        assertEquals("30A-12345", created.getLicensePlate());
        assertEquals("MOTORCYCLE", created.getVehicleType());
        assertEquals("Phạm Minh Đức", created.getFullName());
        assertEquals("0934567890", created.getPhone());

        when(drivers.existsById(accountId)).thenReturn(true);
        assertThrows(DriverConflictException.class,
                () -> service.createDriverProfile(accountId, request, "Phạm Minh Đức", "0934567890"));
    }

    @Test
    void reservedOrOnTripDriverCannotGoOffline() {
        UUID driverId = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");
        when(drivers.goOffline(driverId)).thenReturn(0);
        when(drivers.existsById(driverId)).thenReturn(true);

        assertThrows(InvalidStateTransitionException.class, () -> service.goOffline(driverId));
        verify(geo, never()).removeDriver(driverId);
    }

    @Test
    void staleLocationIsExcludedAndEvictedFromNearbySearch() {
        UUID freshDriverId = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");
        UUID staleDriverId = UUID.fromString("5e11b65c-36ef-47cd-9019-9db767cf8d01");

        var freshDriver = new Driver();
        freshDriver.setId(freshDriverId);
        freshDriver.setStatus(DriverStatus.AVAILABLE);

        var staleDriver = new Driver();
        staleDriver.setId(staleDriverId);
        staleDriver.setStatus(DriverStatus.AVAILABLE);

        var freshLocation = mock(DriverLocation.class);
        when(freshLocation.getDriverId()).thenReturn(freshDriverId);
        when(freshLocation.getUpdatedAt()).thenReturn(LocalDateTime.now().minusSeconds(30));

        var staleLocation = mock(DriverLocation.class);
        when(staleLocation.getDriverId()).thenReturn(staleDriverId);
        when(staleLocation.getUpdatedAt()).thenReturn(LocalDateTime.now().minusMinutes(10));

        when(geo.findNearbyDrivers(21.0285, 105.8542, 5.0)).thenReturn(
                List.of(new NearbyDriverResult(freshDriverId, 0.5), new NearbyDriverResult(staleDriverId, 1.2)));
        when(drivers.findByIdInAndStatus(List.of(freshDriverId, staleDriverId), DriverStatus.AVAILABLE))
            .thenReturn(List.of(freshDriver, staleDriver));
        when(locations.findAllById(List.of(freshDriverId, staleDriverId)))
            .thenReturn(List.of(freshLocation, staleLocation));

        var results = service.findAvailableNearby(21.0285, 105.8542, 5.0);
        assertEquals(1, results.size());
        assertEquals(freshDriverId, results.get(0).getId());
        verify(geo).removeDriver(staleDriverId);
        assertTrue(results.stream().noneMatch(d -> d.getId().equals(staleDriverId)));
    }

    @Test
    void repeatedLifecycleOperationsAreIdempotentWhileDifferentTripStillConflicts() {
        UUID driverId = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");
        UUID tripId = UUID.fromString("93d8f465-65ac-491d-a4d0-b29cc65775cd");
        UUID reservationId = UUID.fromString("734b66d6-cdc0-487a-9e06-32a81246d891");

        var request = new ReserveDriverRequest();
        request.setTripId(tripId);
        request.setReservationId(reservationId);

        var driver = new Driver();
        driver.setId(driverId);
        driver.setStatus(DriverStatus.RESERVED);
        driver.setCurrentTripId(tripId);
        driver.setReservationId(reservationId);
        driver.setUpdatedAt(LocalDateTime.now());

        when(drivers.existsById(driverId)).thenReturn(true);
        when(drivers.findById(driverId)).thenReturn(Optional.of(driver));

        // 1. Gọi lặp lại reserve cho cùng tripId + reservationId -> thành công
        // (idempotent)
        when(drivers.reserveDriverAtomic(driverId, tripId, reservationId)).thenReturn(0);
        var reservedAgain = service.reserveDriver(driverId, request);
        assertEquals("RESERVED", reservedAgain.getStatus());
        assertEquals(tripId, reservedAgain.getCurrentTripId());

        // 2. Chuyến khác cố giữ cùng tài xế -> 409 Conflict
        var otherTripRequest = new ReserveDriverRequest();
        otherTripRequest.setTripId(UUID.randomUUID());
        otherTripRequest.setReservationId(UUID.randomUUID());
        assertThrows(DriverConflictException.class, () -> service.reserveDriver(driverId, otherTripRequest));

        // 3. Gọi lặp lại startTrip khi tài xế đã ON_TRIP -> thành công (idempotent)
        driver.setStatus(DriverStatus.ON_TRIP);
        when(drivers.startTrip(driverId)).thenReturn(0);
        assertEquals("ON_TRIP", service.startTrip(driverId).getStatus());

        // 4. Gọi lặp lại completeTrip và releaseDriver khi tài xế đã về AVAILABLE ->
        // thành công (idempotent)
        driver.setStatus(DriverStatus.AVAILABLE);
        driver.setCurrentTripId(null);
        driver.setReservationId(null);
        when(drivers.completeTrip(driverId)).thenReturn(0);
        when(drivers.releaseDriver(driverId)).thenReturn(0);
        assertEquals("AVAILABLE", service.completeTrip(driverId).getStatus());
        assertEquals("AVAILABLE", service.releaseDriver(driverId).getStatus());
    }

    @Test
    void expiredReservationsAreAutomaticallyReleasedAndRestoredToGeo() {
        UUID driverId = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");
        var expiredDriver = new Driver();
        expiredDriver.setId(driverId);
        expiredDriver.setStatus(DriverStatus.RESERVED);
        expiredDriver.setUpdatedAt(LocalDateTime.now().minusMinutes(5));

        var location = mock(DriverLocation.class);
        when(location.getLatitude()).thenReturn(21.0285);
        when(location.getLongitude()).thenReturn(105.8542);
        when(location.getUpdatedAt()).thenReturn(LocalDateTime.now().minusSeconds(20));

        when(drivers.findExpiredReservations(any(LocalDateTime.class))).thenReturn(List.of(expiredDriver));
        when(drivers.releaseDriver(driverId)).thenReturn(1);
        when(locations.findById(driverId)).thenReturn(Optional.of(location));

        int released = service.releaseExpiredReservations();
        assertEquals(1, released);
        verify(drivers).releaseDriver(driverId);
        verify(geo).updateLocation(driverId, 21.0285, 105.8542);
    }

    @Test
    void concurrentReserveAcrossTwoDriverInstancesAllowsOnlyOneWinner() throws Exception {
        UUID driverId = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");
        var instance1 = new DriverServiceImpl(drivers, geo, locations, new DriverMapper(), "driver-service-instance-1");
        var instance2 = new DriverServiceImpl(drivers, geo, locations, new DriverMapper(), "driver-service-instance-2");

        var atomicClaimed = new java.util.concurrent.atomic.AtomicBoolean(false);
        var currentDriverState = new Driver();
        currentDriverState.setId(driverId);
        currentDriverState.setStatus(DriverStatus.AVAILABLE);
        currentDriverState.setUpdatedAt(LocalDateTime.now());

        when(drivers.existsById(driverId)).thenReturn(true);
        when(drivers.findById(driverId)).thenReturn(Optional.of(currentDriverState));
        when(drivers.reserveDriverAtomic(org.mockito.ArgumentMatchers.eq(driverId), any(UUID.class), any(UUID.class)))
            .thenAnswer(invocation -> {
                if (atomicClaimed.compareAndSet(false, true)) {
                    UUID winningTrip = invocation.getArgument(1);
                    UUID winningRes = invocation.getArgument(2);
                    currentDriverState.setStatus(DriverStatus.RESERVED);
                    currentDriverState.setCurrentTripId(winningTrip);
                    currentDriverState.setReservationId(winningRes);
                    currentDriverState.setUpdatedAt(LocalDateTime.now());
                    return 1;
                }
                return 0;
            });

        var req1 = new ReserveDriverRequest();
        req1.setTripId(UUID.randomUUID());
        req1.setReservationId(UUID.randomUUID());

        var req2 = new ReserveDriverRequest();
        req2.setTripId(UUID.randomUUID());
        req2.setReservationId(UUID.randomUUID());

        var startLatch = new java.util.concurrent.CountDownLatch(1);
        var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var future1 = pool.submit(() -> {
                startLatch.await();
                return instance1.reserveDriver(driverId, req1);
            });
            var future2 = pool.submit(() -> {
                startLatch.await();
                return instance2.reserveDriver(driverId, req2);
            });
            startLatch.countDown();

            int successCount = 0;
            int conflictCount = 0;
            for (var future : List.of(future1, future2)) {
                try {
                    var resp = future.get();
                    assertEquals("RESERVED", resp.getStatus());
                    successCount++;
                }
                catch (java.util.concurrent.ExecutionException ex) {
                    assertTrue(ex.getCause() instanceof DriverConflictException);
                    conflictCount++;
                }
            }
            assertEquals(1, successCount);
            assertEquals(1, conflictCount);
        }
        finally {
            pool.shutdownNow();
        }
    }

}
