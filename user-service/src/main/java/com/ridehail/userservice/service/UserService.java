package com.ridehail.userservice.service;

import java.util.UUID;

import com.ridehail.userservice.dto.request.UpdateProfileRequest;
import com.ridehail.userservice.dto.response.UserResponse;

public interface UserService {

    UserResponse getUserById(UUID userId);

    UserResponse getUserByEmail(String email);

    UserResponse updateProfile(UUID userId, UpdateProfileRequest request);

}
