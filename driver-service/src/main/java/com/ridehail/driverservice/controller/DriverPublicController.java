package com.ridehail.driverservice.controller;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ridehail.driverservice.config.exception.ForbiddenException;
import com.ridehail.driverservice.config.exception.UnauthorizedException;
import com.ridehail.driverservice.dto.request.CreateDriverProfileRequest;
import com.ridehail.driverservice.dto.request.LocationUpdateRequest;
import com.ridehail.driverservice.dto.response.DriverResponse;
import com.ridehail.driverservice.service.DriverService;

/**
 * Controller xử lý các API public của Driver Service (đi qua Gateway) Bao gồm: tạo/xem hồ
 * sơ tài xế của chính mình, cập nhật vị trí, tìm tài xế, xem thông tin, bật/tắt app
 */
@RestController
@RequestMapping("/drivers")
public class DriverPublicController {

    private final DriverService driverService;

    public DriverPublicController(DriverService driverService) {
        this.driverService = driverService;
    }

    /**
     * POST /drivers (hoặc POST /drivers/me) - Tài xế đăng nhập tạo hồ sơ tài xế của chính
     * mình (dùng chung ID với tài khoản User)
     */
    @PostMapping({ "", "/me" })
    public ResponseEntity<DriverResponse> createMyProfile(
            @RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @RequestHeader(value = "X-User-Roles", required = false) String roles,
            @RequestHeader(value = "X-User-Full-Name", required = false) String fullName,
            @RequestHeader(value = "X-User-Phone", required = false) String phone,
            @Valid @RequestBody CreateDriverProfileRequest request) {

        requireDriverAccount(userId, roles, true);
        DriverResponse response = driverService.createDriverProfile(userId, request, fullName, phone);
        return ResponseEntity.status(HttpStatus.CREATED)
            .header("X-Handled-By-Instance", driverService.getInstanceId())
            .body(response);
    }

    /**
     * GET /drivers/me - Tài xế đăng nhập xem hồ sơ tài xế của chính mình
     */
    @GetMapping("/me")
    public ResponseEntity<DriverResponse> getMyProfile(
            @RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @RequestHeader(value = "X-User-Roles", required = false) String roles) {

        requireDriverAccount(userId, roles, false);
        DriverResponse response = driverService.getDriverById(userId);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * GET /drivers/{id} - Lấy thông tin tài xế theo ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<DriverResponse> getDriverById(@PathVariable UUID id) {
        DriverResponse response = driverService.getDriverById(id);

        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /drivers/{id}/location - Cập nhật vị trí GPS tài xế (Redis GEO) Chỉ chính tài
     * xế đó mới được cập nhật vị trí của mình
     */
    @PostMapping("/{id}/location")
    public ResponseEntity<Map<String, String>> updateLocation(@PathVariable UUID id,
            @RequestHeader(value = "X-User-Id", required = false) UUID requesterId,
            @RequestHeader(value = "X-User-Roles", required = false) String roles,
            @Valid @RequestBody LocationUpdateRequest request) {

        requireDriverOwnership(id, requesterId, roles);
        driverService.updateLocation(id, request);

        return ResponseEntity.ok()
            .header("X-Handled-By-Instance", driverService.getInstanceId())
            .body(Map.of("message", "Cập nhật vị trí tài xế thành công", "driverId", id.toString(), "handledBy",
                    driverService.getInstanceId()));
    }

    /**
     * POST /drivers/me/location - Tài xế đăng nhập cập nhật vị trí của chính mình
     */
    @PostMapping("/me/location")
    public ResponseEntity<Map<String, String>> updateMyLocation(
            @RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @RequestHeader(value = "X-User-Roles", required = false) String roles,
            @Valid @RequestBody LocationUpdateRequest request) {

        requireDriverAccount(userId, roles, false);
        driverService.updateLocation(userId, request);

        return ResponseEntity.ok()
            .header("X-Handled-By-Instance", driverService.getInstanceId())
            .body(Map.of("message", "Cập nhật vị trí tài xế thành công", "driverId", userId.toString(), "handledBy",
                    driverService.getInstanceId()));
    }

    /**
     * GET /drivers/available - Tìm tài xế khả dụng trong bán kính (Redis GEO +
     * PostgreSQL) Params: lat, lng, radius (km, mặc định 5km)
     */
    @GetMapping("/available")
    public ResponseEntity<List<DriverResponse>> findAvailableNearby(@RequestParam double lat, @RequestParam double lng,
            @RequestParam(defaultValue = "5") double radius) {

        List<DriverResponse> drivers = driverService.findAvailableNearby(lat, lng, radius);

        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(drivers);
    }

    /**
     * POST /drivers/{id}/go-online - Tài xế bật app (OFFLINE → AVAILABLE) Chỉ chính tài
     * xế đó mới được bật nhận chuyến
     */
    @PostMapping("/{id}/go-online")
    public ResponseEntity<DriverResponse> goOnline(@PathVariable UUID id,
            @RequestHeader(value = "X-User-Id", required = false) UUID requesterId,
            @RequestHeader(value = "X-User-Roles", required = false) String roles) {

        requireDriverOwnership(id, requesterId, roles);
        DriverResponse response = driverService.goOnline(id);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /drivers/me/go-online - Tài xế đăng nhập bật nhận chuyến
     */
    @PostMapping("/me/go-online")
    public ResponseEntity<DriverResponse> goOnlineMe(@RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @RequestHeader(value = "X-User-Roles", required = false) String roles) {

        requireDriverAccount(userId, roles, false);
        DriverResponse response = driverService.goOnline(userId);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /drivers/{id}/go-offline - Tài xế tắt app (AVAILABLE → OFFLINE) Chỉ chính tài
     * xế đó mới được tắt nhận chuyến; không tắt được khi đang RESERVED hoặc ON_TRIP
     */
    @PostMapping("/{id}/go-offline")
    public ResponseEntity<DriverResponse> goOffline(@PathVariable UUID id,
            @RequestHeader(value = "X-User-Id", required = false) UUID requesterId,
            @RequestHeader(value = "X-User-Roles", required = false) String roles) {

        requireDriverOwnership(id, requesterId, roles);
        DriverResponse response = driverService.goOffline(id);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /drivers/me/go-offline - Tài xế đăng nhập tắt nhận chuyến
     */
    @PostMapping("/me/go-offline")
    public ResponseEntity<DriverResponse> goOfflineMe(@RequestHeader(value = "X-User-Id", required = false) UUID userId,
            @RequestHeader(value = "X-User-Roles", required = false) String roles) {

        requireDriverAccount(userId, roles, false);
        DriverResponse response = driverService.goOffline(userId);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    private void requireDriverOwnership(UUID targetDriverId, UUID requesterId, String roles) {
        requireDriverAccount(requesterId, roles, false);
        if (!targetDriverId.equals(requesterId)) {
            throw new ForbiddenException("Chỉ tài xế đó mới được thao tác trên hồ sơ của chính mình");
        }
    }

    private void requireDriverAccount(UUID userId, String roles, boolean requireRoleHeader) {
        if (userId == null) {
            throw new UnauthorizedException("Không có thông tin xác thực người dùng");
        }
        if (roles == null || roles.isBlank()) {
            if (requireRoleHeader) {
                throw new ForbiddenException("Chỉ tài khoản có vai trò ROLE_DRIVER mới được tạo hồ sơ tài xế");
            }
            return;
        }
        boolean isDriver = Arrays.stream(roles.split(",")).map(String::trim).anyMatch("ROLE_DRIVER"::equals);
        if (!isDriver) {
            throw new ForbiddenException("Chỉ tài khoản có vai trò ROLE_DRIVER mới có hồ sơ tài xế");
        }
    }

}
