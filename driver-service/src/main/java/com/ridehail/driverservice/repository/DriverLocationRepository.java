package com.ridehail.driverservice.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.ridehail.driverservice.entity.DriverLocation;

public interface DriverLocationRepository extends JpaRepository<DriverLocation, String> {

    @Modifying
    @Query(value = """
            INSERT INTO driver_locations (driver_id, latitude, longitude, updated_at)
            VALUES (:driverId, :latitude, :longitude, CURRENT_TIMESTAMP)
            ON CONFLICT (driver_id) DO UPDATE
            SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
                updated_at = EXCLUDED.updated_at
            """, nativeQuery = true)
    void upsert(@Param("driverId") String driverId, @Param("latitude") double latitude,
            @Param("longitude") double longitude);

}
