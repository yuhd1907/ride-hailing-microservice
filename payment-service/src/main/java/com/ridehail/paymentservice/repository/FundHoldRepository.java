package com.ridehail.paymentservice.repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.entity.FundHold;
import com.ridehail.paymentservice.entity.HoldStatus;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FundHoldRepository extends JpaRepository<FundHold, UUID> {

    Optional<FundHold> findByTripId(UUID tripId);

    @Query("select coalesce(sum(h.amount), cast(0 as big_decimal)) from FundHold h "
            + "where h.userId = :userId and h.status = com.ridehail.paymentservice.entity.HoldStatus.HELD")
    BigDecimal sumHeldByUserId(@Param("userId") UUID userId);

    List<FundHold> findByStatusAndExpiresAtBefore(HoldStatus status, Instant before, Pageable pageable);

}
