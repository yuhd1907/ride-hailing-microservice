package com.ridehail.driverservice.controller;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.ridehail.driverservice.config.RequestContextFilter;
import com.ridehail.driverservice.config.exception.GlobalExceptionHandler;
import com.ridehail.driverservice.config.exception.DriverNotFoundException;
import com.ridehail.driverservice.dto.request.ReserveDriverRequest;
import com.ridehail.driverservice.dto.response.DriverResponse;
import com.ridehail.driverservice.service.DriverService;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DriverHttpErrorsTest {

    private DriverService service;

    private MockMvc mvc;

    @BeforeEach
    void setup() {
        service = mock(DriverService.class);
        mvc = MockMvcBuilders
            .standaloneSetup(new DriverPublicController(service), new DriverInternalController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestContextFilter("driver-test"))
            .build();
    }

    @Test
    void malformedBodyReturns400() throws Exception {
        mvc.perform(
                post("/drivers/ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f/location").contentType(MediaType.APPLICATION_JSON)
                    .content("{"))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void latitudesUnsupportedByRedisAreRejectedBeforePersistence() throws Exception {
        mvc.perform(
                post("/drivers/ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f/location").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"latitude\":89,\"longitude\":105}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.latitude").exists());
        verifyNoInteractions(service);
    }

    @Test
    void invalidNumberReturns400InsteadOf500() throws Exception {
        mvc.perform(get("/drivers/available").param("lat", "north").param("lng", "105"))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void missingCoordinatesReturn400InsteadOf500() throws Exception {
        mvc.perform(get("/internal/drivers/available").param("lat", "21")).andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @ParameterizedTest
    @ValueSource(
            strings = { "/drivers/not-a-uuid", "/drivers/not-a-uuid/location", "/internal/drivers/not-a-uuid/reserve" })
    void malformedIdsReturn400BeforeCallingTheService(String path) throws Exception {
        if (path.endsWith("not-a-uuid")) {
            mvc.perform(get(path)).andExpect(status().isBadRequest());
        }
        else {
            mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service);
    }

    @ParameterizedTest
    @ValueSource(strings = { "{\"tripId\":\"not-a-uuid\",\"reservationId\":\"734b66d6-cdc0-487a-9e06-32a81246d891\"}",
            "{\"tripId\":\"93d8f465-65ac-491d-a4d0-b29cc65775cd\",\"reservationId\":\"not-a-uuid\"}", "{}" })
    void reservationRequiresBothIdsToBeValidUuids(String body) throws Exception {
        mvc.perform(post("/internal/drivers/ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f/reserve")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body)).andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void reservationAcceptsUuidFieldsAndSerializesThemAsStrings() throws Exception {
        UUID driverId = UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f");
        UUID tripId = UUID.fromString("93d8f465-65ac-491d-a4d0-b29cc65775cd");
        UUID reservationId = UUID.fromString("734b66d6-cdc0-487a-9e06-32a81246d891");
        when(service.reserveDriver(eq(driverId), any())).thenAnswer(invocation -> {
            ReserveDriverRequest request = invocation.getArgument(1);
            assertEquals(tripId, request.getTripId());
            assertEquals(reservationId, request.getReservationId());
            var response = new DriverResponse();
            response.setId(driverId);
            response.setCurrentTripId(request.getTripId());
            response.setReservationId(request.getReservationId());
            return response;
        });
        mvc.perform(post("/internal/drivers/" + driverId + "/reserve").contentType(MediaType.APPLICATION_JSON)
            .content("{\"tripId\":\"" + tripId + "\",\"reservationId\":\"" + reservationId + "\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(driverId.toString()))
            .andExpect(jsonPath("$.currentTripId").value(tripId.toString()))
            .andExpect(jsonPath("$.reservationId").value(reservationId.toString()));
        verify(service).reserveDriver(eq(driverId), any());
    }

    @Test
    void missingDriverWithAValidUuidReturns404() throws Exception {
        UUID driverId = UUID.randomUUID();
        when(service.getDriverById(driverId)).thenThrow(new DriverNotFoundException("Missing driver"));
        mvc.perform(get("/drivers/" + driverId)).andExpect(status().isNotFound());
    }

    @Test
    void createAndViewOwnDriverProfileSharesAccountUuid() throws Exception {
        UUID accountId = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");
        var response = new DriverResponse();
        response.setId(accountId);
        response.setLicensePlate("30A-12345");
        response.setVehicleType("MOTORCYCLE");
        when(service.createDriverProfile(eq(accountId), any(), eq("Phạm Minh Đức"), eq("0934567890")))
            .thenReturn(response);
        when(service.getDriverById(accountId)).thenReturn(response);

        mvc.perform(post("/drivers").header("X-User-Id", accountId.toString())
            .header("X-User-Roles", "ROLE_DRIVER")
            .header("X-User-Full-Name", "Phạm Minh Đức")
            .header("X-User-Phone", "0934567890")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"licensePlate\":\"30A-12345\",\"vehicleType\":\"MOTORCYCLE\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(accountId.toString()))
            .andExpect(jsonPath("$.licensePlate").value("30A-12345"))
            .andExpect(jsonPath("$.vehicleType").value("MOTORCYCLE"));

        mvc.perform(get("/drivers/me").header("X-User-Id", accountId.toString()).header("X-User-Roles", "ROLE_DRIVER"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(accountId.toString()))
            .andExpect(jsonPath("$.licensePlate").value("30A-12345"));
    }

    @Test
    void passengerCannotCreateOrViewDriverProfile() throws Exception {
        UUID passengerId = UUID.fromString("26a7f8fe-79a8-49ea-a46a-9529e5c3e381");
        mvc.perform(post("/drivers").header("X-User-Id", passengerId.toString())
            .header("X-User-Roles", "ROLE_PASSENGER")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"licensePlate\":\"30A-12345\",\"vehicleType\":\"MOTORCYCLE\"}"))
            .andExpect(status().isForbidden());

        mvc.perform(
                get("/drivers/me").header("X-User-Id", passengerId.toString()).header("X-User-Roles", "ROLE_PASSENGER"))
            .andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void driverCannotModifyAnotherDriversStatusOrLocation() throws Exception {
        UUID driverA = UUID.fromString("fd699acc-6544-44a9-9634-5396060c61b8");
        UUID driverB = UUID.fromString("5e11b65c-36ef-47cd-9019-9db767cf8d01");

        mvc.perform(post("/drivers/" + driverB + "/go-online").header("X-User-Id", driverA.toString())
            .header("X-User-Roles", "ROLE_DRIVER")).andExpect(status().isForbidden());

        mvc.perform(post("/drivers/" + driverB + "/go-offline").header("X-User-Id", driverA.toString())
            .header("X-User-Roles", "ROLE_DRIVER")).andExpect(status().isForbidden());

        mvc.perform(post("/drivers/" + driverB + "/location").header("X-User-Id", driverA.toString())
            .header("X-User-Roles", "ROLE_DRIVER")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"latitude\":21.0285,\"longitude\":105.8542}")).andExpect(status().isForbidden());

        verifyNoInteractions(service);
    }

}
