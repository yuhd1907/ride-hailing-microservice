package com.ridehail.paymentservice.repository;

import java.util.List;
import java.util.UUID;

import com.ridehail.paymentservice.entity.BankTransaction;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BankTransactionRepository extends JpaRepository<BankTransaction, UUID> {

    List<BankTransaction> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

}
