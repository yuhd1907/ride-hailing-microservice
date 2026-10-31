package com.ridehail.userservice.service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.ridehail.userservice.config.exception.UnauthorizedException;
import com.ridehail.userservice.config.security.jwt.JwtService;
import com.ridehail.userservice.dto.request.LoginRequest;
import com.ridehail.userservice.entity.AccountStatus;
import com.ridehail.userservice.entity.User;
import com.ridehail.userservice.mapper.UserMapper;
import com.ridehail.userservice.repository.UserRepository;
import com.ridehail.userservice.service.impl.AuthServiceImpl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class UserAuthenticationTest {

    @Test
    void seedPasswordsMatchTheDocumentedLogin() throws Exception {
        String sql = Files.readString(Path.of("../scripts/seed-data.sql"));
        var hashes = Pattern.compile("\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}").matcher(sql);
        var encoder = new BCryptPasswordEncoder();
        int count = 0;
        while (hashes.find()) {
            assertTrue(encoder.matches("Password@123", hashes.group()), "Seed password differs from README");
            count++;
        }
        assertEquals(3, count);
    }

    @Test
    void unknownEmailAndIncorrectPasswordHaveTheSameAuthenticationError() {
        var repository = mock(UserRepository.class);
        var encoder = mock(PasswordEncoder.class);
        var jwt = mock(JwtService.class);
        var service = new AuthServiceImpl(repository, encoder, jwt, mock(TokenBlacklistService.class),
                new UserMapper());
        var request = new LoginRequest();
        request.setEmail("person@example.com");
        request.setPassword("wrong");
        when(repository.findByEmail(request.getEmail())).thenReturn(Optional.empty());
        var missing = assertThrows(UnauthorizedException.class, () -> service.login(request));
        var user = new User();
        user.setStatus(AccountStatus.ACTIVE);
        user.setPasswordHash("encoded-password");
        when(repository.findByEmail(request.getEmail())).thenReturn(Optional.of(user));
        when(encoder.matches("wrong", "encoded-password")).thenReturn(false);
        var incorrect = assertThrows(UnauthorizedException.class, () -> service.login(request));
        assertEquals(missing.getMessage(), incorrect.getMessage());
        verifyNoInteractions(jwt);
    }

}
