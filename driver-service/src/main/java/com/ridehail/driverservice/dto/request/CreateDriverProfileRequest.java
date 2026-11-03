package com.ridehail.driverservice.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * DTO tạo hồ sơ tài xế gắn với tài khoản đăng nhập (dùng chung ID)
 */
public class CreateDriverProfileRequest {

    @NotBlank(message = "Biển số xe không được để trống")
    @Size(min = 3, max = 20, message = "Biển số xe phải từ 3-20 ký tự")
    @Pattern(regexp = "^(?=.*\\S)[A-Za-z0-9.-]{3,20}$", message = "Biển số xe không đúng định dạng")
    private String licensePlate;

    @NotBlank(message = "Loại xe không được để trống")
    @Pattern(regexp = "^(MOTORCYCLE|CAR_4_SEAT|CAR_7_SEAT)$",
            message = "Loại xe phải là MOTORCYCLE, CAR_4_SEAT hoặc CAR_7_SEAT")
    private String vehicleType;

    @Size(min = 2, max = 100, message = "Họ tên phải từ 2-100 ký tự")
    @Pattern(regexp = "^.*\\S.*$", message = "Họ tên không được chỉ chứa khoảng trắng")
    private String fullName;

    @Pattern(regexp = "^0\\d{9}$", message = "Số điện thoại phải là 10 chữ số bắt đầu bằng 0 (VD: 0901234567)")
    private String phone;

    public CreateDriverProfileRequest() {
    }

    public String getLicensePlate() {
        return licensePlate;
    }

    public void setLicensePlate(String licensePlate) {
        this.licensePlate = licensePlate;
    }

    public String getVehicleType() {
        return vehicleType;
    }

    public void setVehicleType(String vehicleType) {
        this.vehicleType = vehicleType;
    }

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
