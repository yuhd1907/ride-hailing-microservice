package com.ridehail.paymentservice.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.entity.Payment;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PaymentRepository extends JpaRepository<Payment, UUID> {

    Optional<Payment> findByIdempotencyKey(UUID idempotencyKey);

    List<Payment> findByRiderIdOrderByCreatedAtDesc(UUID riderId, Pageable pageable);

    List<Payment> findByTripIdOrderByCreatedAtAsc(UUID tripId);

}
