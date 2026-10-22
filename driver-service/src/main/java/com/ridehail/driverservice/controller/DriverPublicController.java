package com.ridehail.driverservice.controller;

import java.util.List;
import java.util.Map;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ridehail.driverservice.dto.request.LocationUpdateRequest;
import com.ridehail.driverservice.dto.response.DriverResponse;
import com.ridehail.driverservice.service.DriverService;

/**
 * Controller xử lý các API public của Driver Service (đi qua Gateway) Bao gồm: cập nhật
 * vị trí, tìm tài xế, xem thông tin, bật/tắt app
 */
@RestController
@RequestMapping("/drivers")
public class DriverPublicController {

    private final DriverService driverService;

    public DriverPublicController(DriverService driverService) {
        this.driverService = driverService;
    }

    /**
     * GET /drivers/{id} - Lấy thông tin tài xế theo ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<DriverResponse> getDriverById(@PathVariable String id) {
        DriverResponse response = driverService.getDriverById(id);

        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /drivers/{id}/location - Cập nhật vị trí GPS tài xế (Redis GEO)
     */
    @PostMapping("/{id}/location")
    public ResponseEntity<Map<String, String>> updateLocation(@PathVariable String id,
            @Valid @RequestBody LocationUpdateRequest request) {

        driverService.updateLocation(id, request);

        return ResponseEntity.ok()
            .header("X-Handled-By-Instance", driverService.getInstanceId())
            .body(Map.of("message", "Cập nhật vị trí tài xế thành công", "driverId", id, "handledBy",
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
     * POST /drivers/{id}/go-online - Tài xế bật app (OFFLINE → AVAILABLE)
     */
    @PostMapping("/{id}/go-online")
    public ResponseEntity<DriverResponse> goOnline(@PathVariable String id) {

        DriverResponse response = driverService.goOnline(id);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /drivers/{id}/go-offline - Tài xế tắt app (AVAILABLE → OFFLINE)
     */
    @PostMapping("/{id}/go-offline")
    public ResponseEntity<DriverResponse> goOffline(@PathVariable String id) {

        DriverResponse response = driverService.goOffline(id);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

}
