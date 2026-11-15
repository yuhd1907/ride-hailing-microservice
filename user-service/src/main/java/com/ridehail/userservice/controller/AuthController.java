package com.ridehail.userservice.controller;

import java.util.Map;

import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ridehail.userservice.config.exception.UnauthorizedException;
import com.ridehail.userservice.dto.request.LoginRequest;
import com.ridehail.userservice.dto.request.RegisterRequest;
import com.ridehail.userservice.dto.response.JwtResponse;
import com.ridehail.userservice.dto.response.UserResponse;
import com.ridehail.userservice.service.AuthService;

/**
 * Controller xử lý Đăng ký, Đăng nhập, Đăng xuất
 */
@RestController
@RequestMapping("/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * POST /auth/register - Đăng ký tài khoản mới
     */
    @PostMapping("/register")
    public ResponseEntity<UserResponse> register(@Valid @RequestBody RegisterRequest request) {
        MDC.put("action", "REGISTER");
        log.debug("Nhận yêu cầu đăng ký tài khoản: {}", request.getEmail());

        UserResponse response = authService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /**
     * POST /auth/login - Đăng nhập và nhận JWT Token
     */
    @PostMapping("/login")
    public ResponseEntity<JwtResponse> login(@Valid @RequestBody LoginRequest request) {
        MDC.put("action", "LOGIN");
        log.debug("Nhận yêu cầu đăng nhập: {}", request.getEmail());

        JwtResponse response = authService.login(request);
        return ResponseEntity.ok(response);
    }

    /**
     * POST /auth/logout - Đăng xuất (đưa token vào Redis Blacklist)
     */
    @PostMapping("/logout")
    public ResponseEntity<Map<String, String>> logout(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        MDC.put("action", "LOGOUT");

        if (authHeader == null || !authHeader.regionMatches(true, 0, "Bearer ", 0, 7)
                || authHeader.substring(7).isBlank()) {
            throw new UnauthorizedException("Cần cung cấp Bearer token hợp lệ");
        }
        String token = authHeader.substring(7).trim();
        authService.logout(token);

        log.debug("Đăng xuất thành công, token đã bị thu hồi");
        return ResponseEntity.ok(Map.of("message", "Đăng xuất thành công. Token đã bị thu hồi."));
    }

}
