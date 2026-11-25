package com.ridehail.userservice.dto.response;

import java.time.LocalDateTime;
import java.util.UUID;

import com.ridehail.userservice.entity.EmergencyContact;

public record EmergencyContactResponse(UUID id, String name, String phone, String relationship, LocalDateTime createdAt) {

    public static EmergencyContactResponse of(EmergencyContact c) {
        return new EmergencyContactResponse(c.getId(), c.getName(), c.getPhone(), c.getRelationship(), c.getCreatedAt());
    }

}
