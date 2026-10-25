package com.ridehail.driverservice.dto.response;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * DTO phản hồi thông tin tài xế
 */
public class DriverResponse {

    private UUID id;

    private String fullName;

    private String phone;

    private String licensePlate;

    private String vehicleType;

    private String status;

    private UUID currentTripId;

    private UUID reservationId;

    private Double distance; // Khoảng cách từ khách (km) - chỉ có khi tìm kiếm nearby

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    // === Constructors ===
    public DriverResponse() {
    }

    public DriverResponse(UUID id, String fullName, String phone, String licensePlate, String vehicleType,
            String status, UUID currentTripId, UUID reservationId, LocalDateTime createdAt, LocalDateTime updatedAt) {
        this.id = id;
        this.fullName = fullName;
        this.phone = phone;
        this.licensePlate = licensePlate;
        this.vehicleType = vehicleType;
        this.status = status;
        this.currentTripId = currentTripId;
        this.reservationId = reservationId;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // === Getters & Setters ===
    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getLicensePlate() {
        return licensePlate;
    }

    public void setLicensePlate(String licensePlate) {
        this.licensePlate = licensePlate;
    }

    public String getVehicleType() {
        return vehicleType;
    }

    public void setVehicleType(String vehicleType) {
        this.vehicleType = vehicleType;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public UUID getCurrentTripId() {
        return currentTripId;
    }

    public void setCurrentTripId(UUID currentTripId) {
        this.currentTripId = currentTripId;
    }

    public UUID getReservationId() {
        return reservationId;
    }

    public void setReservationId(UUID reservationId) {
        this.reservationId = reservationId;
    }

    public Double getDistance() {
        return distance;
    }

    public void setDistance(Double distance) {
        this.distance = distance;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

}
