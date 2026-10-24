package com.ridehail.userservice.config;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.SimpleTransactionStatus;

import com.ridehail.userservice.config.security.jwt.JwtService;
import com.ridehail.userservice.dto.request.RegisterRequest;
import com.ridehail.userservice.mapper.UserMapper;
import com.ridehail.userservice.repository.UserRepository;
import com.ridehail.userservice.service.AuthService;
import com.ridehail.userservice.service.UserService;
import com.ridehail.userservice.service.impl.AuthServiceImpl;
import com.ridehail.userservice.service.impl.TokenBlacklistServiceImpl;
import com.ridehail.userservice.service.impl.UserServiceImpl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ServiceWiringTest {

    @Test
    void authAndProfileServicesResolveTheirDependenciesAndKeepTransactionBoundaries() {
        UserRepository repository = mock(UserRepository.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any(TransactionDefinition.class)))
            .thenAnswer(invocation -> new SimpleTransactionStatus());
        when(encoder.encode("Password@123")).thenReturn("encoded-password");
        when(repository.save(any())).thenAnswer(invocation -> {
            com.ridehail.userservice.entity.User user = invocation.getArgument(0);
            user.setId(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"));
            when(repository.findById(user.getId())).thenReturn(Optional.of(user));
            return user;
        });

        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.setEnvironment(new MockEnvironment()
                .withProperty("jwt.secret", "test-only-jwt-signing-key-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdef")
                .withProperty("jwt.expiration-ms", "60000"));
            context.registerBean(UserRepository.class, () -> repository);
            context.registerBean(PasswordEncoder.class, () -> encoder);
            context.registerBean(StringRedisTemplate.class, () -> mock(StringRedisTemplate.class));
            context.registerBean(PlatformTransactionManager.class, () -> transactions);
            context.register(Transactions.class, AuthServiceImpl.class, UserServiceImpl.class,
                    TokenBlacklistServiceImpl.class, UserMapper.class, JwtService.class);
            context.refresh();

            AuthService authService = context.getBean(AuthService.class);
            UserService userService = context.getBean(UserService.class);
            assertTrue(AopUtils.isAopProxy(authService));
            assertTrue(AopUtils.isAopProxy(userService));

            RegisterRequest request = new RegisterRequest();
            request.setEmail("wiring@example.com");
            request.setPassword("Password@123");
            request.setFullName("Wiring User");
            request.setPhone("0901234567");
            request.setRole("ROLE_PASSENGER");
            assertEquals(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"),
                    authService.register(request).getId());
            assertEquals("wiring@example.com",
                    userService.getUserById(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f")).getEmail());
            verify(transactions, times(2)).commit(any());
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    static class Transactions {

    }

}
