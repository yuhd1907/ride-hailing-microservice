package com.ridehail.userservice.dto.response;

import java.util.Set;
import java.util.UUID;

/**
 * DTO phản hồi JWT Token sau khi đăng nhập thành công
 */
public class JwtResponse {

    private String token;

    private String type = "Bearer";

    private UUID userId;

    private String email;

    private Set<String> roles;

    private long expiresIn;

    public JwtResponse(String token, UUID userId, String email, Set<String> roles, long expiresIn) {
        this.token = token;
        this.userId = userId;
        this.email = email;
        this.roles = roles;
        this.expiresIn = expiresIn;
    }

    // === Getters & Setters ===
    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public UUID getUserId() {
        return userId;
    }

    public void setUserId(UUID userId) {
        this.userId = userId;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public Set<String> getRoles() {
        return roles;
    }

    public void setRoles(Set<String> roles) {
        this.roles = roles;
    }

    public long getExpiresIn() {
        return expiresIn;
    }

    public void setExpiresIn(long expiresIn) {
        this.expiresIn = expiresIn;
    }

}
