package com.ridehail.notificationservice.repository;

import java.util.UUID;

import com.ridehail.notificationservice.entity.ProcessedEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcessedEventRepository extends JpaRepository<ProcessedEvent, UUID> {

}
