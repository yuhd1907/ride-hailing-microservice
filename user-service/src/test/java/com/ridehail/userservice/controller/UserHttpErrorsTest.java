package com.ridehail.userservice.controller;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.ridehail.userservice.config.RequestContextFilter;
import com.ridehail.userservice.config.exception.GlobalExceptionHandler;
import com.ridehail.userservice.config.exception.UnauthorizedException;
import com.ridehail.userservice.config.exception.ResourceNotFoundException;
import com.ridehail.userservice.dto.response.UserResponse;
import com.ridehail.userservice.service.AuthService;
import com.ridehail.userservice.service.UserService;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class UserHttpErrorsTest {

    private UserService service;

    private AuthService authService;

    private MockMvc mvc;

    @BeforeEach
    void setup() {
        service = mock(UserService.class);
        authService = mock(AuthService.class);
        mvc = MockMvcBuilders
            .standaloneSetup(new AuthController(authService), new UserController(service),
                    new UserInternalController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new RequestContextFilter("user-test"))
            .build();
    }

    @Test
    void malformedJsonReturns400AndPreservesCorrelationId() throws Exception {
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content("{")
            .header("X-Correlation-ID", "trace-input-error"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.correlationId").value("trace-input-error"))
            .andExpect(header().string("X-Correlation-ID", "trace-input-error"));
        verifyNoInteractions(service, authService);
    }

    @Test
    void unsupportedMethodRemains405() throws Exception {
        mvc.perform(get("/auth/login")).andExpect(status().isMethodNotAllowed());
    }

    @Test
    void loginFailuresAre401() throws Exception {
        when(authService.login(any())).thenThrow(new UnauthorizedException("Email hoặc mật khẩu không đúng"));
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content("{\"email\":\"test@example.com\",\"password\":\"incorrect\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void missingLogoutAuthorizationIs401() throws Exception {
        mvc.perform(post("/auth/logout")).andExpect(status().isUnauthorized());
        verifyNoInteractions(service, authService);
    }

    @ParameterizedTest
    @ValueSource(strings = { "Basic abc", "Bearer ", "not-Bearer token" })
    void invalidLogoutAuthorizationIs401(String authorization) throws Exception {
        mvc.perform(post("/auth/logout").header("Authorization", authorization)).andExpect(status().isUnauthorized());
        verifyNoInteractions(service, authService);
    }

    @Test
    void anotherUsersProfileCannotBeChanged() throws Exception {
        mvc.perform(put("/users/b83ea108-d819-4bb8-b213-986c3a38e0bd")
            .header("X-User-Id", "dd2226b7-2535-42ef-a438-638c63b3a981")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"fullName\":\"Changed Name\"}")).andExpect(status().isForbidden());
        verifyNoInteractions(service, authService);
    }

    @Test
    void whitespaceOnlyNamesAreRejected() throws Exception {
        mvc.perform(put("/users/ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f")
            .header("X-User-Id", "ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"fullName\":\"  \"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.fullName").exists());
        verifyNoInteractions(service, authService);
    }

    @Test
    void concurrentDuplicateRegistrationReturns409() throws Exception {
        when(authService.register(any())).thenThrow(new DataIntegrityViolationException("unique email"));
        mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON)
            .content(
                    "{\"email\":\"test@example.com\",\"password\":\"Password@123\",\"fullName\":\"Test User\",\"phone\":\"0901234567\",\"role\":\"ROLE_PASSENGER\"}"))
            .andExpect(status().isConflict());
    }

    @Test
    void malformedUserIdReturns400BeforeCallingTheService() throws Exception {
        mvc.perform(get("/users/not-a-uuid")).andExpect(status().isBadRequest());
        mvc.perform(get("/users/me").header("X-User-Id", "not-a-uuid")).andExpect(status().isBadRequest());
        verifyNoInteractions(service, authService);
    }

    @Test
    void profileUsesUuidHeaderAndSerializesItsIdAsAString() throws Exception {
        UUID userId = UUID.randomUUID();
        var response = new UserResponse();
        response.setId(userId);
        when(service.getUserById(userId)).thenReturn(response);
        mvc.perform(get("/users/me").header("X-User-Id", userId.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(userId.toString()));
        verify(service).getUserById(userId);
    }

    @Test
    void missingUserWithAValidUuidReturns404() throws Exception {
        UUID userId = UUID.randomUUID();
        when(service.getUserById(userId)).thenThrow(new ResourceNotFoundException("Missing user"));
        mvc.perform(get("/users/" + userId)).andExpect(status().isNotFound());
    }

    @Test
    void internalAndPublicUserLookupExposeFullNamePhoneAndRolesForOtherServices() throws Exception {
        UUID userId = UUID.fromString("26a7f8fe-79a8-49ea-a46a-9529e5c3e381");
        var response = new UserResponse();
        response.setId(userId);
        response.setFullName("Nguyễn Văn An");
        response.setPhone("0901234567");
        response.setRoles(java.util.Set.of("ROLE_PASSENGER"));
        when(service.getUserById(userId)).thenReturn(response);

        mvc.perform(get("/internal/users/" + userId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(userId.toString()))
            .andExpect(jsonPath("$.fullName").value("Nguyễn Văn An"))
            .andExpect(jsonPath("$.phone").value("0901234567"))
            .andExpect(jsonPath("$.role").value("ROLE_PASSENGER"))
            .andExpect(jsonPath("$.roles[0]").value("ROLE_PASSENGER"));

        mvc.perform(put("/users/me").header("X-User-Id", userId.toString())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"fullName\":\"Nguyễn Văn An Mới\"}")).andExpect(status().isOk());
        verify(service).updateProfile(eq(userId), any());
    }

}
