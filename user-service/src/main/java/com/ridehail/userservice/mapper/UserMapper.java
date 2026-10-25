package com.ridehail.userservice.mapper;

import org.springframework.stereotype.Component;

import com.ridehail.userservice.dto.response.UserResponse;
import com.ridehail.userservice.entity.User;

@Component
public class UserMapper {

    public UserResponse toResponse(User user) {
        return new UserResponse(user.getId(), user.getEmail(), user.getFullName(), user.getPhone(),
                user.getStatus().name(), user.getRoles(), user.getCreatedAt(), user.getUpdatedAt());
    }

}
