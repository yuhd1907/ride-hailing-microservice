package com.ridehail.userservice.service;

import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.ridehail.userservice.config.security.jwt.JwtService;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

class JwtServiceTest {

    @Test
    void repeatedLoginsProduceIndependentTokensSoOneLogoutDoesNotRevokeBoth() {
        var service = new JwtService("test-only-jwt-signing-key-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdef", 60000);
        String first = service.generateToken(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"),
                "user@example.com", Set.of("ROLE_PASSENGER"));
        String second = service.generateToken(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"),
                "user@example.com", Set.of("ROLE_PASSENGER"));
        assertNotEquals(first, second);
        assertEquals("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f", service.parseToken(first).getSubject());
        assertNotEquals(service.parseToken(first).getId(), service.parseToken(second).getId());
    }

}
