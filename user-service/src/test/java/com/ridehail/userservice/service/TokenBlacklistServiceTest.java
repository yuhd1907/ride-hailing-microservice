package com.ridehail.userservice.service;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.data.redis.core.StringRedisTemplate;

import com.ridehail.userservice.service.impl.TokenBlacklistServiceImpl;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class TokenBlacklistServiceTest {

    @ParameterizedTest
    @ValueSource(longs = { 0, -1, -1000 })
    void tokensAlreadyExpiredAreNotWrittenWithAnInvalidRedisTtl(long remaining) {
        var redis = mock(StringRedisTemplate.class);
        new TokenBlacklistServiceImpl(redis).blacklistToken("expired-token", remaining);
        verifyNoInteractions(redis);
    }

}
