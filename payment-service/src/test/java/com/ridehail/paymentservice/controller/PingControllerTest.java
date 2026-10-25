package com.ridehail.paymentservice.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(PingController.class)
class PingControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void pingReturnsUpAndEchoesCorrelationId() throws Exception {
        this.mockMvc.perform(get("/ping").header("X-Correlation-ID", "trace-123"))
            .andExpect(status().isOk())
            .andExpect(content().string("UP"))
            .andExpect(header().string("X-Correlation-ID", "trace-123"));
    }

}
