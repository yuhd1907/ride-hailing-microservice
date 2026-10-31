package com.ridehail.userservice.entity;

/**
 * Trạng thái tài khoản người dùng
 */
public enum AccountStatus {

    ACTIVE, // Tài khoản hoạt động bình thường
    SUSPENDED, // Tài khoản bị đình chỉ tạm thời
    BANNED // Tài khoản bị khóa vĩnh viễn

}
