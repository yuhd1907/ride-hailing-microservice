package com.ridehail.userservice.service.impl;

import java.util.HashSet;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ridehail.userservice.config.exception.ConflictException;
import com.ridehail.userservice.config.exception.UnauthorizedException;
import com.ridehail.userservice.config.security.jwt.JwtService;
import com.ridehail.userservice.dto.request.LoginRequest;
import com.ridehail.userservice.dto.request.RegisterRequest;
import com.ridehail.userservice.dto.response.JwtResponse;
import com.ridehail.userservice.dto.response.UserResponse;
import com.ridehail.userservice.entity.AccountStatus;
import com.ridehail.userservice.entity.User;
import com.ridehail.userservice.mapper.UserMapper;
import com.ridehail.userservice.repository.UserRepository;
import com.ridehail.userservice.service.AuthService;
import com.ridehail.userservice.service.TokenBlacklistService;

@Service
public class AuthServiceImpl implements AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthServiceImpl.class);

    private final UserRepository userRepository;

    private final PasswordEncoder passwordEncoder;

    private final JwtService jwtService;

    private final TokenBlacklistService tokenBlacklistService;

    private final UserMapper userMapper;

    public AuthServiceImpl(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtService jwtService,
            TokenBlacklistService tokenBlacklistService, UserMapper userMapper) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.tokenBlacklistService = tokenBlacklistService;
        this.userMapper = userMapper;
    }

    @Override
    @Transactional
    public UserResponse register(RegisterRequest request) {
        MDC.put("action", "REGISTER");

        // Kiểm tra trùng email
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new ConflictException("Email '" + request.getEmail() + "' đã được sử dụng");
        }

        // Kiểm tra trùng số điện thoại
        if (userRepository.existsByPhone(request.getPhone())) {
            throw new ConflictException("Số điện thoại '" + request.getPhone() + "' đã được sử dụng");
        }

        User user = new User();
        user.setEmail(request.getEmail());
        user.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        user.setFullName(request.getFullName());
        user.setPhone(request.getPhone());
        user.setStatus(AccountStatus.ACTIVE);

        Set<String> roles = new HashSet<>();
        roles.add(request.getRole());
        user.setRoles(roles);

        User savedUser = userRepository.save(user);
        log.info("Đăng ký thành công user: {} ({})", savedUser.getId(), savedUser.getEmail());

        return userMapper.toResponse(savedUser);
    }

    @Override
    @Transactional(readOnly = true)
    public JwtResponse login(LoginRequest request) {
        MDC.put("action", "LOGIN");

        User user = userRepository.findByEmail(request.getEmail())
            .orElseThrow(() -> new UnauthorizedException("Email hoặc mật khẩu không đúng"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            throw new UnauthorizedException("Email hoặc mật khẩu không đúng");
        }

        if (user.getStatus() != AccountStatus.ACTIVE) {
            throw new ConflictException("Tài khoản đã bị " + user.getStatus().name().toLowerCase());
        }

        String token = jwtService.generateToken(user.getId(), user.getEmail(), user.getRoles());
        log.info("Đăng nhập thành công user: {} ({})", user.getId(), user.getEmail());

        return new JwtResponse(token, user.getId(), user.getEmail(), user.getRoles(), jwtService.getExpirationMs());
    }

    @Override
    public void logout(String token) {
        MDC.put("action", "LOGOUT");

        long remainingMs = jwtService.getRemainingExpirationMs(token);
        tokenBlacklistService.blacklistToken(token, remainingMs);

        log.info("Token đã được đưa vào blacklist, TTL: {}ms", remainingMs);
    }

}
