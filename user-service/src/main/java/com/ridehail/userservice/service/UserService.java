package com.ridehail.userservice.service;

import com.ridehail.userservice.dto.request.UpdateProfileRequest;
import com.ridehail.userservice.dto.response.UserResponse;

public interface UserService {

    UserResponse getUserById(String userId);

    UserResponse getUserByEmail(String email);

    UserResponse updateProfile(String userId, UpdateProfileRequest request);

}
