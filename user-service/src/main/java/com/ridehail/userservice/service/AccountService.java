package com.ridehail.userservice.service;

import java.util.List;
import java.util.UUID;

import com.ridehail.userservice.dto.request.ChangePasswordRequest;
import com.ridehail.userservice.dto.request.EmergencyContactRequest;
import com.ridehail.userservice.dto.response.EmergencyContactResponse;

/**
 * Bảo mật tài khoản và an toàn: đổi mật khẩu, danh sách liên hệ khẩn cấp.
 */
public interface AccountService {

    void changePassword(UUID userId, ChangePasswordRequest request);

    List<EmergencyContactResponse> emergencyContacts(UUID userId);

    EmergencyContactResponse addEmergencyContact(UUID userId, EmergencyContactRequest request);

    void deleteEmergencyContact(UUID userId, UUID contactId);

}
