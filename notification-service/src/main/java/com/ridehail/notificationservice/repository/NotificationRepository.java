package com.ridehail.notificationservice.repository;

import java.util.UUID;

import com.ridehail.notificationservice.entity.Notification;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

}
