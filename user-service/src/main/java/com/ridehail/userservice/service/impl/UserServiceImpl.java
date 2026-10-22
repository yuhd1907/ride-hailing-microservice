package com.ridehail.userservice.service.impl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ridehail.userservice.config.exception.ConflictException;
import com.ridehail.userservice.config.exception.ResourceNotFoundException;
import com.ridehail.userservice.dto.request.UpdateProfileRequest;
import com.ridehail.userservice.dto.response.UserResponse;
import com.ridehail.userservice.entity.User;
import com.ridehail.userservice.mapper.UserMapper;
import com.ridehail.userservice.repository.UserRepository;
import com.ridehail.userservice.service.UserService;

@Service
public class UserServiceImpl implements UserService {

    private static final Logger log = LoggerFactory.getLogger(UserServiceImpl.class);

    private final UserRepository userRepository;

    private final UserMapper userMapper;

    public UserServiceImpl(UserRepository userRepository, UserMapper userMapper) {
        this.userRepository = userRepository;
        this.userMapper = userMapper;
    }

    @Override
    @Transactional(readOnly = true)
    public UserResponse getUserById(String userId) {
        User user = userRepository.findById(userId)
            .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy user với ID: " + userId));
        return userMapper.toResponse(user);
    }

    @Override
    @Transactional(readOnly = true)
    public UserResponse getUserByEmail(String email) {
        User user = userRepository.findByEmail(email)
            .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy user với email: " + email));
        return userMapper.toResponse(user);
    }

    @Override
    @Transactional
    public UserResponse updateProfile(String userId, UpdateProfileRequest request) {
        MDC.put("action", "UPDATE_PROFILE");

        User user = userRepository.findById(userId)
            .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy user với ID: " + userId));

        if (request.getFullName() != null && !request.getFullName().isBlank()) {
            user.setFullName(request.getFullName());
        }

        if (request.getPhone() != null && !request.getPhone().isBlank()) {
            // Kiểm tra trùng số điện thoại với user khác
            userRepository.findByPhone(request.getPhone()).ifPresent(existingUser -> {
                if (!existingUser.getId().equals(userId)) {
                    throw new ConflictException("Số điện thoại '" + request.getPhone() + "' đã được sử dụng");
                }
            });
            user.setPhone(request.getPhone());
        }

        User savedUser = userRepository.save(user);
        log.info("Cập nhật hồ sơ thành công user: {}", savedUser.getId());

        return userMapper.toResponse(savedUser);
    }

}
