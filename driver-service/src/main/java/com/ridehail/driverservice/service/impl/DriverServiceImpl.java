package com.ridehail.driverservice.service.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ridehail.driverservice.config.exception.DriverConflictException;
import com.ridehail.driverservice.config.exception.DriverNotFoundException;
import com.ridehail.driverservice.config.exception.InvalidStateTransitionException;
import com.ridehail.driverservice.dto.request.LocationUpdateRequest;
import com.ridehail.driverservice.dto.request.ReserveDriverRequest;
import com.ridehail.driverservice.dto.response.DriverResponse;
import com.ridehail.driverservice.dto.response.NearbyDriverResult;
import com.ridehail.driverservice.entity.Driver;
import com.ridehail.driverservice.entity.DriverStatus;
import com.ridehail.driverservice.mapper.DriverMapper;
import com.ridehail.driverservice.repository.DriverLocationRepository;
import com.ridehail.driverservice.repository.DriverRepository;
import com.ridehail.driverservice.service.DriverLocationRedisService;
import com.ridehail.driverservice.service.DriverService;
import com.ridehail.driverservice.util.GeoValidation;

/**
 * Business logic cho quản lý tài xế Kết hợp Redis GEO (tìm kiếm siêu tốc) và PostgreSQL
 * Row-Level Lock (ACID)
 */
@Service
public class DriverServiceImpl implements DriverService {

    private static final Logger log = LoggerFactory.getLogger(DriverServiceImpl.class);

    private final DriverRepository driverRepository;

    private final DriverLocationRedisService locationService;

    private final DriverLocationRepository driverLocationRepository;

    private final String instanceId;

    private final DriverMapper driverMapper;

    public DriverServiceImpl(DriverRepository driverRepository, DriverLocationRedisService locationService,
            DriverLocationRepository driverLocationRepository, DriverMapper driverMapper,
            @Value("${eureka.instance.instance-id:unknown}") String instanceId) {
        this.driverRepository = driverRepository;
        this.locationService = locationService;
        this.driverLocationRepository = driverLocationRepository;
        this.driverMapper = driverMapper;
        this.instanceId = instanceId;
    }

    /**
     * Lấy thông tin tài xế theo ID
     */
    @Override
    @Transactional(readOnly = true)
    public DriverResponse getDriverById(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế với ID: " + driverId));
        return driverMapper.toResponse(driver);
    }

    /**
     * Cập nhật vị trí GPS tài xế vào Redis GEO
     */
    @Override
    @Transactional
    public void updateLocation(UUID driverId, LocationUpdateRequest request) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "UPDATE_LOCATION");

        // Kiểm tra tài xế tồn tại
        GeoValidation.coordinates(request.getLatitude(), request.getLongitude());
        // Serialize GPS writes with reserve/release so stale state cannot remove
        // a driver's GEO entry immediately after it becomes AVAILABLE again.
        Driver driver = driverRepository.findByIdForLocationUpdate(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế với ID: " + driverId));

        driverLocationRepository.upsert(driverId, request.getLatitude(), request.getLongitude());
        if (driver.getStatus() == DriverStatus.AVAILABLE) {
            locationService.updateLocation(driverId, request.getLatitude(), request.getLongitude());
        }
        else {
            locationService.removeDriver(driverId);
        }
        log.info("[{}] Cập nhật vị trí driverId={} -> ({}, {})", instanceId, driverId, request.getLatitude(),
                request.getLongitude());
    }

    /**
     * Tìm tài xế khả dụng (AVAILABLE) trong bán kính quanh tọa độ khách hàng
     *
     * Flow: 1. Redis GEO tìm tất cả tài xế trong bán kính (< 1ms) 2. Lọc trong PostgreSQL
     * chỉ lấy những tài xế có status = AVAILABLE 3. Trả về danh sách sắp xếp từ gần → xa
     */
    @Override
    @Transactional(readOnly = true)
    public List<DriverResponse> findAvailableNearby(double latitude, double longitude, double radiusKm) {
        GeoValidation.search(latitude, longitude, radiusKm);
        MDC.put("action", "FIND_NEARBY");
        long startTime = System.currentTimeMillis();

        // Step 1: Redis GEO tìm tài xế trong bán kính
        List<NearbyDriverResult> nearbyResults = locationService.findNearbyDrivers(latitude, longitude, radiusKm);

        if (nearbyResults.isEmpty()) {
            log.info("[{}] Không tìm thấy tài xế nào trong bán kính {}km", instanceId, radiusKm);
            return new ArrayList<>();
        }

        // Step 2: Lọc chỉ lấy tài xế AVAILABLE trong PostgreSQL
        List<UUID> nearbyIds = nearbyResults.stream().map(NearbyDriverResult::getDriverId).collect(Collectors.toList());

        List<Driver> availableDrivers = driverRepository.findByIdInAndStatus(nearbyIds, DriverStatus.AVAILABLE);

        // Step 3: Map khoảng cách từ Redis vào DriverResponse
        Map<UUID, Double> distanceMap = nearbyResults.stream()
            .collect(Collectors.toMap(NearbyDriverResult::getDriverId, NearbyDriverResult::getDistanceKm));

        List<DriverResponse> result = availableDrivers.stream().map(driver -> {
            DriverResponse resp = driverMapper.toResponse(driver);
            resp.setDistance(distanceMap.get(driver.getId()));
            return resp;
        })
            .sorted((a, b) -> Double.compare(a.getDistance(), b.getDistance())) // Gần
                                                                                // nhất
                                                                                // trước
            .collect(Collectors.toList());

        long duration = System.currentTimeMillis() - startTime;
        log.info("[{}] Tìm thấy {} tài xế khả dụng trong {}km, xử lý trong {}ms", instanceId, result.size(), radiusKm,
                duration);

        return result;
    }

    /**
     * Giữ tài xế nguyên tử (Atomic Reserve) - Row-Level Lock PostgreSQL Chỉ thành công
     * nếu tài xế đang AVAILABLE, trả 409 Conflict nếu bị tranh chấp
     */
    @Override
    @Transactional
    public DriverResponse reserveDriver(UUID driverId, ReserveDriverRequest request) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "RESERVE_DRIVER");
        MDC.put("tripId", request.getTripId().toString());
        MDC.put("reservationId", request.getReservationId().toString());

        int updatedRows = driverRepository.reserveDriverAtomic(driverId, request.getTripId(),
                request.getReservationId());

        if (updatedRows == 0) {
            requireDriverExists(driverId);
            log.warn("[{}] CONFLICT: driverId={} không thể giữ (đã bị giữ hoặc không available)", instanceId, driverId);
            throw new DriverConflictException(
                    "Tài xế " + driverId + " không khả dụng. Có thể đã bị giữ bởi request khác (409 Conflict)");
        }

        // Xóa khỏi Redis GEO vì tài xế không còn available
        locationService.removeDriver(driverId);

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        log.info("[{}] Giữ driverId={} thành công cho tripId={}", instanceId, driverId, request.getTripId());
        return driverMapper.toResponse(driver);
    }

    /**
     * Giải phóng tài xế (Saga Compensate / Hủy chuyến)
     */
    @Override
    @Transactional
    public DriverResponse releaseDriver(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "RELEASE_DRIVER");

        int updatedRows = driverRepository.releaseDriver(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            throw new InvalidStateTransitionException(
                    "Không thể giải phóng tài xế " + driverId + ". Tài xế không ở trạng thái RESERVED hoặc ON_TRIP");
        }

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        restoreLocation(driverId);
        log.info("[{}] Giải phóng driverId={} thành công", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Bắt đầu chuyến (RESERVED → ON_TRIP)
     */
    @Override
    @Transactional
    public DriverResponse startTrip(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "START_TRIP");

        int updatedRows = driverRepository.startTrip(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            throw new InvalidStateTransitionException(
                    "Không thể bắt đầu chuyến cho tài xế " + driverId + ". Tài xế phải ở trạng thái RESERVED");
        }

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        log.info("[{}] driverId={} bắt đầu chuyến", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Hoàn thành chuyến (ON_TRIP → AVAILABLE)
     */
    @Override
    @Transactional
    public DriverResponse completeTrip(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "COMPLETE_TRIP");

        int updatedRows = driverRepository.completeTrip(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            throw new InvalidStateTransitionException(
                    "Không thể hoàn thành chuyến cho tài xế " + driverId + ". Tài xế phải ở trạng thái ON_TRIP");
        }

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        restoreLocation(driverId);
        log.info("[{}] driverId={} hoàn thành chuyến", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Tài xế bật app (OFFLINE → AVAILABLE)
     */
    @Override
    @Transactional
    public DriverResponse goOnline(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "GO_ONLINE");

        int updatedRows = driverRepository.goOnline(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            throw new InvalidStateTransitionException(
                    "Không thể bật online cho tài xế " + driverId + ". Tài xế phải ở trạng thái OFFLINE");
        }

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        restoreLocation(driverId);
        log.info("[{}] driverId={} đã bật app (ONLINE)", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Tài xế tắt app (AVAILABLE → OFFLINE)
     */
    @Override
    @Transactional
    public DriverResponse goOffline(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "GO_OFFLINE");

        int updatedRows = driverRepository.goOffline(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            throw new InvalidStateTransitionException(
                    "Không thể tắt app cho tài xế " + driverId + ". Tài xế phải ở trạng thái AVAILABLE");
        }

        // Xóa khỏi Redis GEO
        locationService.removeDriver(driverId);

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        log.info("[{}] driverId={} đã tắt app (OFFLINE)", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Lấy instance ID (dùng cho header X-Handled-By-Instance)
     */
    @Override
    public String getInstanceId() {
        return instanceId;
    }

    private void requireDriverExists(UUID driverId) {
        if (!driverRepository.existsById(driverId)) {
            throw new DriverNotFoundException("Không tìm thấy tài xế: " + driverId);
        }
    }

    private void restoreLocation(UUID driverId) {
        driverLocationRepository.findById(driverId)
            .ifPresent(location -> locationService.updateLocation(driverId, location.getLatitude(),
                    location.getLongitude()));
    }

}
