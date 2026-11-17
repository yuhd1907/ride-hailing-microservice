package com.ridehail.driverservice.controller;

import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.ridehail.driverservice.dto.request.RejectTripRequest;
import com.ridehail.driverservice.dto.request.ReserveDriverRequest;
import com.ridehail.driverservice.dto.response.DriverResponse;
import com.ridehail.driverservice.service.DriverService;

/**
 * Controller xử lý các API nội bộ (Internal) cho service-to-service communication Chỉ
 * được gọi từ Matching Service (TV2), Trip Service (TV2), Saga Coordinator (TV3) Gateway
 * chặn tuyệt đối endpoint /internal/** từ bên ngoài (403 Forbidden)
 */
@RestController
@RequestMapping("/internal/drivers")
public class DriverInternalController {

    private final DriverService driverService;

    public DriverInternalController(DriverService driverService) {
        this.driverService = driverService;
    }

    /**
     * GET /internal/drivers/available - Tìm tài xế khả dụng qua Redis GEO (cho TV2
     * Matching Service)
     */
    @GetMapping("/available")
    public ResponseEntity<List<DriverResponse>> findAvailableNearby(@RequestParam double lat, @RequestParam double lng,
            @RequestParam(defaultValue = "5") double radius) {

        List<DriverResponse> drivers = driverService.findAvailableNearby(lat, lng, radius);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(drivers);
    }

    /**
     * POST /internal/drivers/{id}/reserve - Giữ tài xế nguyên tử (cho TV2 Matching
     * Service) Trả về 200 OK nếu thành công, 409 Conflict nếu bị tranh chấp
     */
    @PostMapping("/{id}/reserve")
    public ResponseEntity<DriverResponse> reserveDriver(@PathVariable UUID id,
            @Valid @RequestBody ReserveDriverRequest request) {

        DriverResponse response = driverService.reserveDriver(id, request);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /internal/drivers/{id}/release - Giải phóng tài xế (cho TV3 Saga Coordinator)
     */
    @PostMapping("/{id}/release")
    public ResponseEntity<DriverResponse> releaseDriver(@PathVariable UUID id) {

        DriverResponse response = driverService.releaseDriver(id);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /internal/drivers/{id}/reject - Tài xế từ chối chuyến (cho TV2 Trip Service)
     * Trả tài xế về AVAILABLE ngay; chỉ nhả lượt giữ của đúng tripId trong body
     */
    @PostMapping("/{id}/reject")
    public ResponseEntity<DriverResponse> rejectTrip(@PathVariable UUID id,
            @Valid @RequestBody RejectTripRequest request) {

        DriverResponse response = driverService.rejectTrip(id, request.getTripId());
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /internal/drivers/{id}/start-trip - Bắt đầu chuyến (cho TV2 Trip Service)
     */
    @PostMapping("/{id}/start-trip")
    public ResponseEntity<DriverResponse> startTrip(@PathVariable UUID id) {

        DriverResponse response = driverService.startTrip(id);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

    /**
     * POST /internal/drivers/{id}/complete-trip - Hoàn thành chuyến (cho TV2 Trip
     * Service)
     */
    @PostMapping("/{id}/complete-trip")
    public ResponseEntity<DriverResponse> completeTrip(@PathVariable UUID id) {

        DriverResponse response = driverService.completeTrip(id);
        return ResponseEntity.ok().header("X-Handled-By-Instance", driverService.getInstanceId()).body(response);
    }

}
