package com.ridehail.userservice.dto.request;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * DTO Cập nhật hồ sơ cá nhân - Strict: KHÔNG chứa roles, status, passwordHash
 */
public class UpdateProfileRequest {

    @Size(min = 2, max = 100, message = "Họ tên phải từ 2-100 ký tự")
    @Pattern(regexp = "(?s).*\\S.*", message = "Họ tên không được chỉ chứa khoảng trắng")
    private String fullName;

    @Pattern(regexp = "^0\\d{9}$", message = "Số điện thoại phải là 10 chữ số bắt đầu bằng 0 (VD: 0901234567)")
    private String phone;

    // === Getters & Setters ===
    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

}
