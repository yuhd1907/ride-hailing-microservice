package com.ridehail.userservice.controller;

import java.util.UUID;

import jakarta.validation.Valid;
import org.slf4j.MDC;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ridehail.userservice.config.exception.ForbiddenException;
import com.ridehail.userservice.config.exception.UnauthorizedException;
import com.ridehail.userservice.dto.request.UpdateProfileRequest;
import com.ridehail.userservice.dto.response.UserResponse;
import com.ridehail.userservice.service.UserService;

/**
 * Controller quản lý hồ sơ người dùng
 */
@RestController
@RequestMapping("/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    /**
     * GET /users/me - Lấy thông tin của người dùng hiện tại (qua header X-User-Id do
     * Gateway inject)
     */
    @GetMapping("/me")
    public ResponseEntity<UserResponse> getMyProfile(@RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @RequestHeader(value = "X-User-Email", required = false) String email) {

        if (userId != null) {
            UserResponse response = userService.getUserById(userId);
            return ResponseEntity.ok(response);
        }
        else if (email != null && !email.isBlank()) {
            UserResponse response = userService.getUserByEmail(email);
            return ResponseEntity.ok(response);
        }

        throw new UnauthorizedException("Không có thông tin xác thực người dùng");
    }

    /**
     * GET /users/{id} - Lấy thông tin user theo ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<UserResponse> getUserById(@PathVariable UUID id) {

        UserResponse response = userService.getUserById(id);
        return ResponseEntity.ok(response);
    }

    /**
     * PUT /users/me - Cập nhật hồ sơ của chính người dùng đang đăng nhập
     */
    @PutMapping("/me")
    public ResponseEntity<UserResponse> updateMyProfile(
            @RequestHeader(value = "X-User-Id", required = false) UUID requesterId,
            @Valid @RequestBody UpdateProfileRequest request) {
        if (requesterId == null) {
            throw new UnauthorizedException("Không có thông tin xác thực người dùng");
        }
        MDC.put("action", "UPDATE_PROFILE");

        UserResponse response = userService.updateProfile(requesterId, request);
        return ResponseEntity.ok(response);
    }

    /**
     * PUT /users/{id} - Cập nhật hồ sơ cá nhân (chỉ cho phép sửa hồ sơ của chính mình)
     */
    @PutMapping("/{id}")
    public ResponseEntity<UserResponse> updateProfile(@PathVariable UUID id,
            @RequestHeader(value = "X-User-Id", required = false) UUID requesterId,
            @Valid @RequestBody UpdateProfileRequest request) {
        if (requesterId == null) {
            throw new UnauthorizedException("Không có thông tin xác thực người dùng");
        }
        if (!id.equals(requesterId)) {
            throw new ForbiddenException("Chỉ được cập nhật hồ sơ của chính mình");
        }
        MDC.put("action", "UPDATE_PROFILE");

        UserResponse response = userService.updateProfile(id, request);
        return ResponseEntity.ok(response);
    }

}
