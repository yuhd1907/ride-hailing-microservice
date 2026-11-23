package com.ridehail.paymentservice.repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.entity.FundHold;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FundHoldRepository extends JpaRepository<FundHold, UUID> {

    Optional<FundHold> findByTripId(UUID tripId);

    @Query("select coalesce(sum(h.amount), cast(0 as big_decimal)) from FundHold h "
            + "where h.userId = :userId and h.status = com.ridehail.paymentservice.entity.HoldStatus.HELD")
    BigDecimal sumHeldByUserId(@Param("userId") UUID userId);

    /**
     * Chủ của khoản khoá, đọc dạng projection để không nạp entity vào persistence context
     * trước khi khoá tài khoản.
     */
    @Query("select h.userId from FundHold h where h.tripId = :tripId")
    Optional<UUID> findUserIdByTripId(@Param("tripId") UUID tripId);

    @Query("select h.tripId from FundHold h where h.status = com.ridehail.paymentservice.entity.HoldStatus.HELD "
            + "and h.expiresAt < :now order by h.expiresAt")
    List<UUID> findExpiredHeldTripIds(@Param("now") Instant now, Pageable pageable);

}
