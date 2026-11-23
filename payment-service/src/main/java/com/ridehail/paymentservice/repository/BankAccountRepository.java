package com.ridehail.paymentservice.repository;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.entity.BankAccount;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BankAccountRepository extends JpaRepository<BankAccount, UUID> {

    /**
     * Tạo tài khoản với số dư khởi tạo nếu chưa có. ON CONFLICT để hai giao dịch đầu tiên
     * của cùng một khách chạy đồng thời không lỗi trùng khoá chính.
     */
    @Modifying
    @Query(value = "INSERT INTO bank_accounts (user_id, balance) VALUES (:userId, :balance) "
            + "ON CONFLICT (user_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("balance") BigDecimal balance);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from BankAccount a where a.userId = :userId")
    Optional<BankAccount> findForUpdate(@Param("userId") UUID userId);

}
