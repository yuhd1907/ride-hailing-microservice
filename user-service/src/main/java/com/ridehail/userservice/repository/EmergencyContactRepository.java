package com.ridehail.userservice.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.ridehail.userservice.entity.EmergencyContact;

@Repository
public interface EmergencyContactRepository extends JpaRepository<EmergencyContact, UUID> {

    List<EmergencyContact> findByUserIdOrderByCreatedAtAsc(UUID userId);

    long countByUserId(UUID userId);

    boolean existsByUserIdAndPhone(UUID userId, String phone);

    Optional<EmergencyContact> findByIdAndUserId(UUID id, UUID userId);

}
