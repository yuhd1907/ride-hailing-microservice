package com.ridehail.paymentservice.controller;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import com.ridehail.paymentservice.config.exception.ForbiddenException;
import com.ridehail.paymentservice.config.exception.UnauthorizedException;
import com.ridehail.paymentservice.dto.request.TopUpRequest;
import com.ridehail.paymentservice.dto.response.BankAccountResponse;
import com.ridehail.paymentservice.dto.response.BankTransactionResponse;
import com.ridehail.paymentservice.service.BankService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Ngân hàng ảo của hành khách. Gọi qua Gateway: Gateway kiểm tra JWT và gắn X-User-Id,
 * X-User-Roles; chỉ hành khách xem và nạp tiền vào tài khoản của chính mình.
 */
@RestController
@RequestMapping("/payments/bank")
public class BankController {

    static final String USER_ID_HEADER = "X-User-Id";

    static final String ROLES_HEADER = "X-User-Roles";

    private final BankService bankService;

    public BankController(BankService bankService) {
        this.bankService = bankService;
    }

    @GetMapping("/me")
    public ResponseEntity<BankAccountResponse> account(
            @RequestHeader(value = USER_ID_HEADER, required = false) UUID userId,
            @RequestHeader(value = ROLES_HEADER, required = false) String roles) {
        return ResponseEntity.ok(this.bankService.account(requirePassenger(userId, roles)));
    }

    @GetMapping("/me/transactions")
    public ResponseEntity<List<BankTransactionResponse>> transactions(
            @RequestHeader(value = USER_ID_HEADER, required = false) UUID userId,
            @RequestHeader(value = ROLES_HEADER, required = false) String roles,
            @RequestParam(defaultValue = "20") int limit) {
        return ResponseEntity.ok(this.bankService.transactions(requirePassenger(userId, roles), limit));
    }

    @PostMapping("/me/topup")
    public ResponseEntity<BankAccountResponse> topUp(
            @RequestHeader(value = USER_ID_HEADER, required = false) UUID userId,
            @RequestHeader(value = ROLES_HEADER, required = false) String roles,
            @Valid @RequestBody TopUpRequest request) {
        return ResponseEntity.ok(this.bankService.topUp(requirePassenger(userId, roles), request.amount()));
    }

    static UUID requireRole(UUID userId, String roles, String role) {
        if (userId == null) {
            throw new UnauthorizedException("Thiếu danh tính người dùng, hãy gọi qua Gateway kèm Bearer token");
        }
        boolean allowed = roles != null && Arrays.stream(roles.split(",")).map(String::trim).anyMatch(role::equals);
        if (!allowed) {
            throw new ForbiddenException("Cần vai trò " + role);
        }
        return userId;
    }

    private static UUID requirePassenger(UUID userId, String roles) {
        return requireRole(userId, roles, "ROLE_PASSENGER");
    }

}
