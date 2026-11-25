package com.ridehail.paymentservice.controller;

import java.math.BigDecimal;
import java.util.UUID;

import com.ridehail.paymentservice.dto.response.BankAccountResponse;
import com.ridehail.paymentservice.service.BankService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(BankController.class)
class BankControllerTest {

    private static final UUID USER = UUID.fromString("26a7f8fe-79a8-49ea-a46a-9529e5c3e381");

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private BankService bankService;

    @Test
    void accountRequiresIdentity() throws Exception {
        this.mockMvc.perform(get("/payments/bank/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void accountRequiresPassengerOrDriverRole() throws Exception {
        this.mockMvc
            .perform(
                    get("/payments/bank/me").header("X-User-Id", USER.toString()).header("X-User-Roles", "ROLE_ADMIN"))
            .andExpect(status().isForbidden());
    }

    @Test
    void withdrawRequiresDriverRole() throws Exception {
        this.mockMvc
            .perform(post("/payments/bank/me/withdraw").header("X-User-Id", USER.toString())
                .header("X-User-Roles", "ROLE_PASSENGER")
                .contentType("application/json")
                .content("{\"amount\":100000}"))
            .andExpect(status().isForbidden());
    }

    @Test
    void accountReturnsBalance() throws Exception {
        when(this.bankService.account(USER)).thenReturn(new BankAccountResponse(USER, new BigDecimal("500000"),
                new BigDecimal("125000"), new BigDecimal("375000")));

        this.mockMvc
            .perform(get("/payments/bank/me").header("X-User-Id", USER.toString())
                .header("X-User-Roles", "ROLE_PASSENGER"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.available").value(375000));
    }

    @Test
    void topUpValidatesAmount() throws Exception {
        this.mockMvc
            .perform(post("/payments/bank/me/topup").header("X-User-Id", USER.toString())
                .header("X-User-Roles", "ROLE_PASSENGER")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"amount\": 500}"))
            .andExpect(status().isBadRequest());
        verify(this.bankService, never()).topUp(any(), any());

        when(this.bankService.topUp(USER, new BigDecimal("100000"))).thenReturn(
                new BankAccountResponse(USER, new BigDecimal("600000"), BigDecimal.ZERO, new BigDecimal("600000")));
        this.mockMvc
            .perform(post("/payments/bank/me/topup").header("X-User-Id", USER.toString())
                .header("X-User-Roles", "ROLE_PASSENGER")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"amount\": 100000}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.balance").value(600000));
    }

}
