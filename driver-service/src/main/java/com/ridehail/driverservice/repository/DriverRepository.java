package com.ridehail.driverservice.repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import com.ridehail.driverservice.entity.Driver;
import com.ridehail.driverservice.entity.DriverStatus;

/**
 * Repository truy vấn bảng drivers qua Hibernate/JPA Bao gồm truy vấn Atomic Lock nguyên
 * tử cho Concurrency Control
 */
@Repository
public interface DriverRepository extends JpaRepository<Driver, UUID> {

    List<Driver> findByStatus(DriverStatus status);

    List<Driver> findByIdInAndStatus(List<UUID> ids, DriverStatus status);

    boolean existsByLicensePlate(String licensePlate);

    boolean existsByPhone(String phone);

    @Query("select driver from Driver driver where driver.status = com.ridehail.driverservice.entity.DriverStatus.RESERVED and driver.updatedAt < :cutoff")
    List<Driver> findExpiredReservations(@Param("cutoff") LocalDateTime cutoff);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select driver from Driver driver where driver.id = :driverId")
    Optional<Driver> findByIdForLocationUpdate(@Param("driverId") UUID driverId);

    /**
     * ATOMIC RESERVE: Giữ tài xế nguyên tử bằng Row-Level Lock của PostgreSQL Chỉ thành
     * công khi tài xế đang ở trạng thái AVAILABLE Trả về số dòng cập nhật (1 = thành
     * công, 0 = conflict)
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE drivers
            SET status = 'RESERVED',
                current_trip_id = :tripId,
                reservation_id = :reservationId,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :driverId AND status = 'AVAILABLE'
            """, nativeQuery = true)
    int reserveDriverAtomic(@Param("driverId") UUID driverId, @Param("tripId") UUID tripId,
            @Param("reservationId") UUID reservationId);

    /**
     * RELEASE: Giải phóng tài xế (Saga Compensate hoặc hủy chuyến)
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE drivers
            SET status = 'AVAILABLE',
                current_trip_id = NULL,
                reservation_id = NULL,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :driverId AND status IN ('RESERVED', 'ON_TRIP')
            """, nativeQuery = true)
    int releaseDriver(@Param("driverId") UUID driverId);

    /**
     * REJECT: Tài xế từ chối chuyến đang được giữ cho mình. Chỉ nhả đúng lượt giữ của
     * tripId đó, nên một yêu cầu từ chối đến muộn không thể nhả nhầm lượt giữ của chuyến
     * khác
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE drivers
            SET status = 'AVAILABLE',
                current_trip_id = NULL,
                reservation_id = NULL,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :driverId AND status = 'RESERVED' AND current_trip_id = :tripId
            """, nativeQuery = true)
    int rejectReservation(@Param("driverId") UUID driverId, @Param("tripId") UUID tripId);

    /**
     * START TRIP: Chuyển tài xế từ RESERVED sang ON_TRIP
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE drivers
            SET status = 'ON_TRIP',
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :driverId AND status = 'RESERVED'
            """, nativeQuery = true)
    int startTrip(@Param("driverId") UUID driverId);

    /**
     * COMPLETE TRIP: Hoàn thành chuyến, tài xế trở lại AVAILABLE
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE drivers
            SET status = 'AVAILABLE',
                current_trip_id = NULL,
                reservation_id = NULL,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :driverId AND status = 'ON_TRIP'
            """, nativeQuery = true)
    int completeTrip(@Param("driverId") UUID driverId);

    /**
     * GO ONLINE: Tài xế bật app
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE drivers
            SET status = 'AVAILABLE',
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :driverId AND status = 'OFFLINE'
            """, nativeQuery = true)
    int goOnline(@Param("driverId") UUID driverId);

    /**
     * GO OFFLINE: Tài xế tắt app
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            UPDATE drivers
            SET status = 'OFFLINE',
                current_trip_id = NULL,
                reservation_id = NULL,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :driverId AND status = 'AVAILABLE'
            """, nativeQuery = true)
    int goOffline(@Param("driverId") UUID driverId);

}
