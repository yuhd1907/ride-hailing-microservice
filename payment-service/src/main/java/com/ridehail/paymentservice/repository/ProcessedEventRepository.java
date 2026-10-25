package com.ridehail.paymentservice.repository;

import java.util.UUID;

import com.ridehail.paymentservice.entity.ProcessedEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcessedEventRepository extends JpaRepository<ProcessedEvent, UUID> {

}
