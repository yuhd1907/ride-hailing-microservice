package com.ridehail.userservice.service;

import java.util.Set;

import org.junit.jupiter.api.Test;

import com.ridehail.userservice.config.security.jwt.JwtService;

import static org.junit.jupiter.api.Assertions.assertNotEquals;

class JwtServiceTest {

    @Test
    void repeatedLoginsProduceIndependentTokensSoOneLogoutDoesNotRevokeBoth() {
        var service = new JwtService("mySecretKeyForJwtTokenGenerationRideHailingApp2024VeryLongSecretKey", 60000);
        String first = service.generateToken("user", "user@example.com", Set.of("ROLE_PASSENGER"));
        String second = service.generateToken("user", "user@example.com", Set.of("ROLE_PASSENGER"));
        assertNotEquals(first, second);
        assertNotEquals(service.parseToken(first).getId(), service.parseToken(second).getId());
    }

}
