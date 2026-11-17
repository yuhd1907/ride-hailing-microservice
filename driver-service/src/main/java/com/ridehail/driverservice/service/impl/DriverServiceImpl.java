package com.ridehail.driverservice.service.impl;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ridehail.driverservice.config.exception.DriverConflictException;
import com.ridehail.driverservice.config.exception.DriverNotFoundException;
import com.ridehail.driverservice.config.exception.InvalidStateTransitionException;
import com.ridehail.driverservice.dto.request.CreateDriverProfileRequest;
import com.ridehail.driverservice.dto.request.LocationUpdateRequest;
import com.ridehail.driverservice.dto.request.ReserveDriverRequest;
import com.ridehail.driverservice.dto.response.DriverResponse;
import com.ridehail.driverservice.dto.response.NearbyDriverResult;
import com.ridehail.driverservice.entity.Driver;
import com.ridehail.driverservice.entity.DriverLocation;
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

    private final long locationMaxAgeSeconds;

    private final long reservationTimeoutSeconds;

    @Autowired
    public DriverServiceImpl(DriverRepository driverRepository, DriverLocationRedisService locationService,
            DriverLocationRepository driverLocationRepository, DriverMapper driverMapper,
            @Value("${eureka.instance.instance-id:unknown}") String instanceId,
            @Value("${driver.location.max-age-seconds:300}") long locationMaxAgeSeconds,
            @Value("${driver.reservation.timeout-seconds:60}") long reservationTimeoutSeconds) {
        this.driverRepository = driverRepository;
        this.locationService = locationService;
        this.driverLocationRepository = driverLocationRepository;
        this.driverMapper = driverMapper;
        this.instanceId = instanceId;
        this.locationMaxAgeSeconds = locationMaxAgeSeconds;
        this.reservationTimeoutSeconds = reservationTimeoutSeconds;
    }

    public DriverServiceImpl(DriverRepository driverRepository, DriverLocationRedisService locationService,
            DriverLocationRepository driverLocationRepository, DriverMapper driverMapper, String instanceId,
            long locationMaxAgeSeconds) {
        this(driverRepository, locationService, driverLocationRepository, driverMapper, instanceId,
                locationMaxAgeSeconds, 60L);
    }

    public DriverServiceImpl(DriverRepository driverRepository, DriverLocationRedisService locationService,
            DriverLocationRepository driverLocationRepository, DriverMapper driverMapper, String instanceId) {
        this(driverRepository, locationService, driverLocationRepository, driverMapper, instanceId, 300L, 60L);
    }

    /**
     * Tạo hồ sơ tài xế gắn với tài khoản đăng nhập (dùng chung ID giữa user_db và
     * driver_db)
     */
    @Override
    @Transactional
    public DriverResponse createDriverProfile(UUID driverId, CreateDriverProfileRequest request,
            String fallbackFullName, String fallbackPhone) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "CREATE_DRIVER_PROFILE");

        if (driverRepository.existsById(driverId)) {
            throw new DriverConflictException("Hồ sơ tài xế cho tài khoản " + driverId + " đã tồn tại");
        }

        String licensePlate = request.getLicensePlate().trim();
        if (driverRepository.existsByLicensePlate(licensePlate)) {
            throw new DriverConflictException("Biển số xe '" + licensePlate + "' đã được đăng ký");
        }

        String fullName = resolveFullName(driverId, request.getFullName(), fallbackFullName);
        String phone = resolvePhone(driverId, request.getPhone(), fallbackPhone);
        if (driverRepository.existsByPhone(phone)) {
            throw new DriverConflictException("Số điện thoại '" + phone + "' đã được đăng ký");
        }

        Driver driver = new Driver();
        driver.setId(driverId);
        driver.setFullName(fullName);
        driver.setPhone(phone);
        driver.setLicensePlate(licensePlate);
        driver.setVehicleType(request.getVehicleType().trim());
        driver.setStatus(DriverStatus.OFFLINE);

        Driver savedDriver = driverRepository.save(driver);
        log.debug("[{}] Tạo hồ sơ tài xế thành công driverId={} ({}, {})", instanceId, savedDriver.getId(),
                savedDriver.getLicensePlate(), savedDriver.getVehicleType());
        return driverMapper.toResponse(savedDriver);
    }

    /**
     * Lấy thông tin tài xế theo ID (tự giải phóng nếu giữ chỗ đã quá hạn)
     */
    @Override
    @Transactional
    public DriverResponse getDriverById(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế với ID: " + driverId));
        if (driver.getStatus() == DriverStatus.RESERVED && isReservationExpired(driver)) {
            if (driverRepository.releaseDriver(driverId) > 0) {
                restoreLocation(driverId);
                driver = driverRepository.findById(driverId).orElse(driver);
            }
        }
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
        log.debug("[{}] Cập nhật vị trí driverId={} -> ({}, {})", instanceId, driverId, request.getLatitude(),
                request.getLongitude());
    }

    /**
     * Tìm tài xế khả dụng (AVAILABLE) trong bán kính quanh tọa độ khách hàng
     *
     * Flow: 1. Redis GEO tìm tất cả tài xế trong bán kính (< 1ms) 2. Lọc trong PostgreSQL
     * chỉ lấy những tài xế có status = AVAILABLE 3. Trả về danh sách sắp xếp từ gần → xa
     */
    @Override
    @Transactional
    public List<DriverResponse> findAvailableNearby(double latitude, double longitude, double radiusKm) {
        GeoValidation.search(latitude, longitude, radiusKm);
        MDC.put("action", "FIND_NEARBY");
        long startTime = System.currentTimeMillis();

        // Giải phóng các tài xế bị giữ quá lâu chưa nhận chuyến trước khi tìm kiếm
        releaseExpiredReservations();

        // Step 1: Redis GEO tìm tài xế trong bán kính
        List<NearbyDriverResult> nearbyResults = locationService.findNearbyDrivers(latitude, longitude, radiusKm);

        if (nearbyResults.isEmpty()) {
            log.debug("[{}] Không tìm thấy tài xế nào trong bán kính {}km", instanceId, radiusKm);
            return new ArrayList<>();
        }

        // Step 2: Lọc chỉ lấy tài xế AVAILABLE trong PostgreSQL và có vị trí chưa quá
        // hạn
        List<UUID> nearbyIds = nearbyResults.stream().map(NearbyDriverResult::getDriverId).collect(Collectors.toList());

        List<Driver> availableDrivers = driverRepository.findByIdInAndStatus(nearbyIds, DriverStatus.AVAILABLE);
        Map<UUID, DriverLocation> storedLocations = driverLocationRepository.findAllById(nearbyIds)
            .stream()
            .collect(Collectors.toMap(DriverLocation::getDriverId, location -> location));

        // Step 3: Map khoảng cách từ Redis vào DriverResponse (loại bỏ tài xế lâu không
        // cập nhật vị trí)
        Map<UUID, Double> distanceMap = nearbyResults.stream()
            .collect(Collectors.toMap(NearbyDriverResult::getDriverId, NearbyDriverResult::getDistanceKm));

        List<DriverResponse> result = availableDrivers.stream().filter(driver -> {
            DriverLocation location = storedLocations.get(driver.getId());
            if (location == null) {
                location = driverLocationRepository.findById(driver.getId()).orElse(null);
            }
            if (location != null && isLocationStale(location)) {
                locationService.removeDriver(driver.getId());
                return false;
            }
            return true;
        }).map(driver -> {
            DriverResponse resp = driverMapper.toResponse(driver);
            resp.setDistance(distanceMap.get(driver.getId()));
            return resp;
        })
            .sorted((a, b) -> Double.compare(a.getDistance(), b.getDistance())) // Gần
                                                                                // nhất
                                                                                // trước
            .collect(Collectors.toList());

        long duration = System.currentTimeMillis() - startTime;
        log.debug("[{}] Tìm thấy {} tài xế khả dụng trong {}km, xử lý trong {}ms", instanceId, result.size(), radiusKm,
                duration);

        return result;
    }

    /**
     * Giữ tài xế nguyên tử (Atomic Reserve) - Row-Level Lock PostgreSQL Chỉ thành công
     * nếu tài xế đang AVAILABLE (hoặc gọi lặp lại cùng tripId/reservationId, hoặc giữ chỗ
     * cũ đã quá hạn), trả 409 Conflict nếu bị tranh chấp bởi chuyến khác
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
            Driver existing = driverRepository.findById(driverId).orElse(null);
            if (existing != null && existing.getStatus() == DriverStatus.RESERVED) {
                if (isSameReservation(existing, request)) {
                    log.debug("[{}] Idempotent reserve cho driverId={}, tripId={}", instanceId, driverId,
                            request.getTripId());
                    return driverMapper.toResponse(existing);
                }
                if (isReservationExpired(existing) && driverRepository.releaseDriver(driverId) > 0) {
                    updatedRows = driverRepository.reserveDriverAtomic(driverId, request.getTripId(),
                            request.getReservationId());
                }
            }
            if (updatedRows == 0) {
                log.debug("[{}] CONFLICT: driverId={} không thể giữ (đã bị giữ hoặc không available)", instanceId,
                        driverId);
                throw new DriverConflictException(
                        "Tài xế " + driverId + " không khả dụng. Có thể đã bị giữ bởi request khác (409 Conflict)");
            }
        }

        // Xóa khỏi Redis GEO vì tài xế không còn available
        locationService.removeDriver(driverId);

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        log.debug("[{}] Giữ driverId={} thành công cho tripId={}", instanceId, driverId, request.getTripId());
        return driverMapper.toResponse(driver);
    }

    /**
     * Giải phóng tài xế (Saga Compensate / Hủy chuyến) - Lũy đẳng khi gọi lặp lại
     */
    @Override
    @Transactional
    public DriverResponse releaseDriver(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "RELEASE_DRIVER");

        int updatedRows = driverRepository.releaseDriver(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            Driver existing = driverRepository.findById(driverId).orElse(null);
            if (existing != null && existing.getStatus() == DriverStatus.AVAILABLE) {
                log.debug("[{}] Idempotent release cho driverId={} (đã AVAILABLE)", instanceId, driverId);
                return driverMapper.toResponse(existing);
            }
            throw new InvalidStateTransitionException(
                    "Không thể giải phóng tài xế " + driverId + ". Tài xế không ở trạng thái RESERVED hoặc ON_TRIP");
        }

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        restoreLocation(driverId);
        log.debug("[{}] Giải phóng driverId={} thành công", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Tài xế từ chối chuyến (RESERVED → AVAILABLE ngay, không chờ hết hạn giữ chỗ). Lũy
     * đẳng: nếu tài xế không còn giữ chuyến này thì coi như đã từ chối xong
     */
    @Override
    @Transactional
    public DriverResponse rejectTrip(UUID driverId, UUID tripId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "REJECT_TRIP");
        MDC.put("tripId", tripId.toString());

        int updatedRows = driverRepository.rejectReservation(driverId, tripId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            Driver existing = driverRepository.findById(driverId)
                .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));
            if (existing.getStatus() == DriverStatus.ON_TRIP && tripId.equals(existing.getCurrentTripId())) {
                throw new InvalidStateTransitionException(
                        "Tài xế " + driverId + " đã bắt đầu chuyến " + tripId + " nên không thể từ chối");
            }
            log.debug("[{}] Idempotent reject: driverId={} không còn giữ tripId={}", instanceId, driverId, tripId);
            return driverMapper.toResponse(existing);
        }

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        restoreLocation(driverId);
        log.debug("[{}] driverId={} từ chối tripId={}, trở lại AVAILABLE", instanceId, driverId, tripId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Bắt đầu chuyến (RESERVED → ON_TRIP) - Lũy đẳng khi gọi lặp lại
     */
    @Override
    @Transactional
    public DriverResponse startTrip(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "START_TRIP");

        int updatedRows = driverRepository.startTrip(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            Driver existing = driverRepository.findById(driverId).orElse(null);
            if (existing != null && existing.getStatus() == DriverStatus.ON_TRIP) {
                log.debug("[{}] Idempotent start-trip cho driverId={} (đã ON_TRIP)", instanceId, driverId);
                return driverMapper.toResponse(existing);
            }
            throw new InvalidStateTransitionException(
                    "Không thể bắt đầu chuyến cho tài xế " + driverId + ". Tài xế phải ở trạng thái RESERVED");
        }

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        log.debug("[{}] driverId={} bắt đầu chuyến", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Hoàn thành chuyến (ON_TRIP → AVAILABLE) - Lũy đẳng khi gọi lặp lại
     */
    @Override
    @Transactional
    public DriverResponse completeTrip(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "COMPLETE_TRIP");

        int updatedRows = driverRepository.completeTrip(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            Driver existing = driverRepository.findById(driverId).orElse(null);
            if (existing != null && existing.getStatus() == DriverStatus.AVAILABLE) {
                log.debug("[{}] Idempotent complete-trip cho driverId={} (đã AVAILABLE)", instanceId, driverId);
                return driverMapper.toResponse(existing);
            }
            throw new InvalidStateTransitionException(
                    "Không thể hoàn thành chuyến cho tài xế " + driverId + ". Tài xế phải ở trạng thái ON_TRIP");
        }

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        restoreLocation(driverId);
        log.debug("[{}] driverId={} hoàn thành chuyến", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Tài xế bật app (OFFLINE → AVAILABLE) - Lũy đẳng khi đã AVAILABLE
     */
    @Override
    @Transactional
    public DriverResponse goOnline(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "GO_ONLINE");

        int updatedRows = driverRepository.goOnline(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            Driver existing = driverRepository.findById(driverId).orElse(null);
            if (existing != null && existing.getStatus() == DriverStatus.AVAILABLE) {
                return driverMapper.toResponse(existing);
            }
            throw new InvalidStateTransitionException(
                    "Không thể bật online cho tài xế " + driverId + ". Tài xế phải ở trạng thái OFFLINE");
        }

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        restoreLocation(driverId);
        log.debug("[{}] driverId={} đã bật app (ONLINE)", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Tài xế tắt app (AVAILABLE → OFFLINE) - Lũy đẳng khi đã OFFLINE; từ chối khi
     * RESERVED hoặc ON_TRIP
     */
    @Override
    @Transactional
    public DriverResponse goOffline(UUID driverId) {
        MDC.put("driverId", driverId.toString());
        MDC.put("action", "GO_OFFLINE");

        int updatedRows = driverRepository.goOffline(driverId);
        if (updatedRows == 0) {
            requireDriverExists(driverId);
            Driver existing = driverRepository.findById(driverId).orElse(null);
            if (existing != null && existing.getStatus() == DriverStatus.OFFLINE) {
                return driverMapper.toResponse(existing);
            }
            throw new InvalidStateTransitionException(
                    "Không thể tắt app cho tài xế " + driverId + ". Tài xế phải ở trạng thái AVAILABLE");
        }

        // Xóa khỏi Redis GEO
        locationService.removeDriver(driverId);

        Driver driver = driverRepository.findById(driverId)
            .orElseThrow(() -> new DriverNotFoundException("Không tìm thấy tài xế: " + driverId));

        log.debug("[{}] driverId={} đã tắt app (OFFLINE)", instanceId, driverId);
        return driverMapper.toResponse(driver);
    }

    /**
     * Tự động giải phóng các tài xế bị giữ chỗ (RESERVED) quá lâu mà chưa bắt đầu chuyến
     */
    @Override
    @Transactional
    @Scheduled(fixedDelayString = "${driver.reservation.cleanup-interval-ms:5000}")
    public int releaseExpiredReservations() {
        if (reservationTimeoutSeconds <= 0) {
            return 0;
        }
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(reservationTimeoutSeconds);
        List<Driver> expiredDrivers = driverRepository.findExpiredReservations(cutoff);
        int releasedCount = 0;
        for (Driver driver : expiredDrivers) {
            if (driverRepository.releaseDriver(driver.getId()) > 0) {
                restoreLocation(driver.getId());
                releasedCount++;
                log.debug("[{}] Tự động giải phóng driverId={} do giữ chỗ quá hạn ({}s)", instanceId, driver.getId(),
                        reservationTimeoutSeconds);
            }
        }
        return releasedCount;
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
        driverLocationRepository.findById(driverId).ifPresent(location -> {
            if (isLocationStale(location)) {
                locationService.removeDriver(driverId);
                return;
            }
            locationService.updateLocation(driverId, location.getLatitude(), location.getLongitude());
        });
    }

    private boolean isLocationStale(DriverLocation location) {
        if (location.getUpdatedAt() == null || locationMaxAgeSeconds <= 0) {
            return false;
        }
        return location.getUpdatedAt().isBefore(LocalDateTime.now().minusSeconds(locationMaxAgeSeconds));
    }

    private boolean isReservationExpired(Driver driver) {
        if (driver.getUpdatedAt() == null || reservationTimeoutSeconds <= 0) {
            return false;
        }
        return driver.getUpdatedAt().isBefore(LocalDateTime.now().minusSeconds(reservationTimeoutSeconds));
    }

    private boolean isSameReservation(Driver driver, ReserveDriverRequest request) {
        return request.getTripId().equals(driver.getCurrentTripId())
                && (driver.getReservationId() == null || request.getReservationId().equals(driver.getReservationId()));
    }

    private String resolveFullName(UUID driverId, String requestFullName, String fallbackFullName) {
        if (requestFullName != null && !requestFullName.isBlank()) {
            return requestFullName.trim();
        }
        if (fallbackFullName != null && !fallbackFullName.isBlank()) {
            return fallbackFullName.trim();
        }
        return "Driver " + driverId.toString().substring(0, 8);
    }

    private String resolvePhone(UUID driverId, String requestPhone, String fallbackPhone) {
        if (requestPhone != null && !requestPhone.isBlank()) {
            return requestPhone.trim();
        }
        if (fallbackPhone != null && !fallbackPhone.isBlank()) {
            return fallbackPhone.trim();
        }
        return "09" + String.format("%08d", Math.floorMod(driverId.hashCode(), 100_000_000));
    }

}
