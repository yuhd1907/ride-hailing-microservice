package com.ridehail.driverservice.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.ridehail.driverservice.config.RequestContextFilter;
import com.ridehail.driverservice.config.exception.GlobalExceptionHandler;
import com.ridehail.driverservice.service.DriverService;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
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
        mvc.perform(post("/drivers/id/location").contentType(MediaType.APPLICATION_JSON).content("{"))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void latitudesUnsupportedByRedisAreRejectedBeforePersistence() throws Exception {
        mvc.perform(post("/drivers/id/location").contentType(MediaType.APPLICATION_JSON)
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

}
