package com.ridehail.userservice.controller;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ridehail.userservice.config.exception.UnauthorizedException;
import com.ridehail.userservice.dto.request.ChangePasswordRequest;
import com.ridehail.userservice.dto.request.EmergencyContactRequest;
import com.ridehail.userservice.dto.response.EmergencyContactResponse;
import com.ridehail.userservice.service.AccountService;

/**
 * Tài khoản của người đang đăng nhập (qua Gateway, header X-User-Id): đổi mật khẩu và liên
 * hệ khẩn cấp.
 */
@RestController
@RequestMapping("/users/me")
public class AccountController {

    private final AccountService accountService;

    public AccountController(AccountService accountService) {
        this.accountService = accountService;
    }

    /** PUT /users/me/password - Đổi mật khẩu (cần mật khẩu hiện tại). */
    @PutMapping("/password")
    public ResponseEntity<Void> changePassword(@RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @Valid @RequestBody ChangePasswordRequest request) {
        this.accountService.changePassword(require(userId), request);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/emergency-contacts")
    public ResponseEntity<List<EmergencyContactResponse>> emergencyContacts(
            @RequestHeader(value = "X-User-Id", required = false) UUID userId) {
        return ResponseEntity.ok(this.accountService.emergencyContacts(require(userId)));
    }

    @PostMapping("/emergency-contacts")
    public ResponseEntity<EmergencyContactResponse> addEmergencyContact(
            @RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @Valid @RequestBody EmergencyContactRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(this.accountService.addEmergencyContact(require(userId), request));
    }

    @DeleteMapping("/emergency-contacts/{contactId}")
    public ResponseEntity<Void> deleteEmergencyContact(@RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @PathVariable UUID contactId) {
        this.accountService.deleteEmergencyContact(require(userId), contactId);
        return ResponseEntity.noContent().build();
    }

    private static UUID require(UUID userId) {
        if (userId == null) {
            throw new UnauthorizedException("Không có thông tin xác thực người dùng");
        }
        return userId;
    }

}
