package com.ridehail.driverservice.entity;

/**
 * Trạng thái tài xế (State Machine)
 *
 * OFFLINE → AVAILABLE → RESERVED → ON_TRIP → AVAILABLE → OFFLINE
 *
 * Chuyển trạng thái hợp lệ: - OFFLINE → AVAILABLE (tài xế bật app, bắt đầu nhận chuyến) -
 * AVAILABLE → RESERVED (hệ thống giữ tài xế cho chuyến xe) - AVAILABLE → OFFLINE (tài xế
 * tắt app) - RESERVED → ON_TRIP (tài xế bắt đầu chở khách) - RESERVED → AVAILABLE (hủy
 * giữ, giải phóng tài xế - Saga compensate) - ON_TRIP → AVAILABLE (hoàn thành chuyến xe)
 */
public enum DriverStatus {

    OFFLINE, // Tài xế chưa bật app hoặc đã tắt app
    AVAILABLE, // Tài xế đang rảnh, sẵn sàng nhận chuyến
    RESERVED, // Tài xế đã được giữ cho 1 chuyến cụ thể (chờ xác nhận)
    ON_TRIP // Tài xế đang chở khách

}
