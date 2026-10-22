package com.ridehail.driverservice.mapper;

import org.springframework.stereotype.Component;

import com.ridehail.driverservice.dto.response.DriverResponse;
import com.ridehail.driverservice.entity.Driver;

@Component
public class DriverMapper {

    public DriverResponse toResponse(Driver driver) {
        return new DriverResponse(driver.getId(), driver.getFullName(), driver.getPhone(), driver.getLicensePlate(),
                driver.getVehicleType(), driver.getStatus().name(), driver.getCurrentTripId(),
                driver.getReservationId(), driver.getCreatedAt(), driver.getUpdatedAt());
    }

}
