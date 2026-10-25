package com.ridehail.userservice.service;

import com.ridehail.userservice.dto.request.LoginRequest;
import com.ridehail.userservice.dto.request.RegisterRequest;
import com.ridehail.userservice.dto.response.JwtResponse;
import com.ridehail.userservice.dto.response.UserResponse;

public interface AuthService {

    UserResponse register(RegisterRequest request);

    JwtResponse login(LoginRequest request);

    void logout(String token);

}
