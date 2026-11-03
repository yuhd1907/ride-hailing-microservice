package com.ridehail.userservice.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ridehail.userservice.dto.response.UserResponse;
import com.ridehail.userservice.service.UserService;

/**
 * Controller xử lý các API nội bộ (Internal) cho Trip Service, Notification Service lấy
 * thông tin tên, số điện thoại, vai trò của hành khách / tài xế. Gateway chặn tuyệt đối
 * /internal/** từ bên ngoài (403 Forbidden).
 */
@RestController
@RequestMapping("/internal/users")
public class UserInternalController {

    private final UserService userService;

    public UserInternalController(UserService userService) {
        this.userService = userService;
    }

    /**
     * GET /internal/users/{id} - Lấy thông tin người dùng (fullName, phone, roles/role)
     * cho các microservice nội bộ
     */
    @GetMapping("/{id}")
    public ResponseEntity<UserResponse> getUserById(@PathVariable UUID id) {
        UserResponse response = userService.getUserById(id);
        return ResponseEntity.ok(response);
    }

}
