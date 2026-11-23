package com.ridehail.paymentservice.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.entity.Payment;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;

public interface PaymentRepository extends JpaRepository<Payment, UUID> {

    Optional<Payment> findByIdempotencyKey(UUID idempotencyKey);

    /**
     * Khoá dòng payment (FOR UPDATE): tài xế bấm xác nhận tiền mặt hai lần cùng lúc thì
     * lần sau chờ lần trước commit rồi thấy SUCCESS, không phát payment.succeeded lần
     * hai.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Payment p where p.idempotencyKey = :key")
    Optional<Payment> findForUpdateByIdempotencyKey(@Param("key") UUID idempotencyKey);

    List<Payment> findByRiderIdOrderByCreatedAtDesc(UUID riderId, Pageable pageable);

    List<Payment> findByTripIdOrderByCreatedAtAsc(UUID tripId);

}
