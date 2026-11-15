package com.ridehail.userservice.config.security.jwt;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Set;
import java.util.UUID;
import javax.crypto.SecretKey;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Dịch vụ phát hành và giải mã JWT Token
 */
@Service
public class JwtService {

    private final SecretKey secretKey;

    private final long expirationMs;

    public JwtService(@Value("${jwt.secret}") String secret, @Value("${jwt.expiration-ms}") long expirationMs) {
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationMs = expirationMs;
    }

    /**
     * Phát hành JWT Token với claims: sub (userId), email, roles
     */
    public String generateToken(UUID userId, String email, Set<String> roles) {
        return generateToken(userId, email, null, null, roles);
    }

    /**
     * Phát hành JWT Token kèm thông tin hồ sơ cơ bản cho các service hạ nguồn
     */
    public String generateToken(UUID userId, String email, String fullName, String phone, Set<String> roles) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + expirationMs);

        var builder = Jwts.builder()
            .id(UUID.randomUUID().toString())
            .subject(userId.toString())
            .claim("email", email)
            .claim("roles", String.join(",", roles))
            .issuedAt(now)
            .expiration(expiry);
        if (fullName != null && !fullName.isBlank()) {
            builder.claim("fullName", fullName);
        }
        if (phone != null && !phone.isBlank()) {
            builder.claim("phone", phone);
        }
        return builder.signWith(secretKey).compact();
    }

    /**
     * Giải mã JWT Token và trả về Claims
     */
    public Claims parseToken(String token) {
        return Jwts.parser().verifyWith(secretKey).build().parseSignedClaims(token).getPayload();
    }

    /**
     * Tính thời gian còn lại (ms) trước khi token hết hạn Dùng cho TTL khi đưa token vào
     * Redis Blacklist
     */
    public long getRemainingExpirationMs(String token) {
        Claims claims = parseToken(token);
        Date expiration = claims.getExpiration();
        long remaining = expiration.getTime() - System.currentTimeMillis();
        return Math.max(remaining, 0);
    }

    public long getExpirationMs() {
        return expirationMs;
    }

}
