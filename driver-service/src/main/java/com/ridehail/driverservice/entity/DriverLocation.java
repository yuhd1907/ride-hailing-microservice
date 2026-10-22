package com.ridehail.driverservice.entity;

import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "driver_locations")
public class DriverLocation {

    @Id
    @Column(name = "driver_id", length = 36)
    private String driverId;

    @Column(nullable = false)
    private double latitude;

    @Column(nullable = false)
    private double longitude;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected DriverLocation() {
    }

    public String getDriverId() {
        return driverId;
    }

    public double getLatitude() {
        return latitude;
    }

    public double getLongitude() {
        return longitude;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

}
