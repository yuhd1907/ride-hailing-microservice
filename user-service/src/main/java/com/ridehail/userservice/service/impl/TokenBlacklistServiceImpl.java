package com.ridehail.userservice.service.impl;

import java.time.Duration;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import com.ridehail.userservice.service.TokenBlacklistService;

/**
 * Dịch vụ đưa Token vào Blacklist (Redis) khi Đăng xuất Token sẽ tự động bị xóa khỏi
 * Redis khi hết TTL
 */
@Service
public class TokenBlacklistServiceImpl implements TokenBlacklistService {

    private final StringRedisTemplate redisTemplate;

    private static final String BLACKLIST_PREFIX = "blacklist:";

    public TokenBlacklistServiceImpl(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Đưa Token vào Blacklist với TTL tự động xóa khi token hết hạn
     */
    @Override
    public void blacklistToken(String token, long remainingExpirationMillis) {
        if (remainingExpirationMillis <= 0) {
            return;
        }
        String key = BLACKLIST_PREFIX + token;
        redisTemplate.opsForValue().set(key, "revoked", Duration.ofMillis(remainingExpirationMillis));
    }

    /**
     * Kiểm tra token có nằm trong Blacklist không
     */
    @Override
    public boolean isBlacklisted(String token) {
        String key = BLACKLIST_PREFIX + token;
        return Boolean.TRUE.equals(redisTemplate.hasKey(key));
    }

}
