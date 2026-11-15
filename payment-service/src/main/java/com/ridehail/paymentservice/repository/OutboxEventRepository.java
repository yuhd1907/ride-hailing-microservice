package com.ridehail.paymentservice.repository;

import java.util.List;
import java.util.UUID;

import com.ridehail.paymentservice.entity.OutboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, UUID> {

    /**
     * Khóa các event chưa publish. SKIP LOCKED cho phép nhiều instance cùng chạy relay mà
     * không publish trùng một event.
     */
    @Query(value = "SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY created_at LIMIT :limit "
            + "FOR UPDATE SKIP LOCKED", nativeQuery = true)
    List<OutboxEvent> findPendingForUpdate(@Param("limit") int limit);

    long countByPublishedAtIsNull();

}
