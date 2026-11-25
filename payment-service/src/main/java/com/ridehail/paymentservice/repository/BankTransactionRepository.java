package com.ridehail.paymentservice.repository;

import java.util.List;
import java.util.UUID;

import com.ridehail.paymentservice.entity.BankTransaction;
import com.ridehail.paymentservice.entity.BankTransactionType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BankTransactionRepository extends JpaRepository<BankTransaction, UUID> {

    List<BankTransaction> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    boolean existsByTripIdAndUserIdAndType(UUID tripId, UUID userId, BankTransactionType type);

    java.util.Optional<BankTransaction> findFirstByTripIdAndUserIdAndType(UUID tripId, UUID userId,
            BankTransactionType type);

}
