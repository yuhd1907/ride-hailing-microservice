package com.ridehail.userservice.dto.response;

import java.time.LocalDateTime;
import java.util.Set;
import java.util.UUID;

/**
 * DTO phản hồi thông tin user (không bao giờ trả về passwordHash)
 */
public class UserResponse {

    private UUID id;

    private String email;

    private String fullName;

    private String phone;

    private String status;

    private Set<String> roles;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    // === Constructors ===
    public UserResponse() {
    }

    public UserResponse(UUID id, String email, String fullName, String phone, String status, Set<String> roles,
            LocalDateTime createdAt, LocalDateTime updatedAt) {
        this.id = id;
        this.email = email;
        this.fullName = fullName;
        this.phone = phone;
        this.status = status;
        this.roles = roles;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // === Getters & Setters ===
    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Set<String> getRoles() {
        return roles;
    }

    public void setRoles(Set<String> roles) {
        this.roles = roles;
    }

    public String getRole() {
        if (roles == null || roles.isEmpty()) {
            return null;
        }
        return roles.iterator().next();
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

}
