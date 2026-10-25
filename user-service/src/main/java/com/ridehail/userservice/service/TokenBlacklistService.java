package com.ridehail.userservice.service;

public interface TokenBlacklistService {

    void blacklistToken(String token, long remainingExpirationMillis);

    boolean isBlacklisted(String token);

}
