package com.ridehail.userservice.service.impl;

import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ridehail.userservice.config.exception.BadRequestException;
import com.ridehail.userservice.config.exception.ConflictException;
import com.ridehail.userservice.config.exception.ResourceNotFoundException;
import com.ridehail.userservice.dto.request.ChangePasswordRequest;
import com.ridehail.userservice.dto.request.EmergencyContactRequest;
import com.ridehail.userservice.dto.response.EmergencyContactResponse;
import com.ridehail.userservice.entity.EmergencyContact;
import com.ridehail.userservice.entity.User;
import com.ridehail.userservice.repository.EmergencyContactRepository;
import com.ridehail.userservice.repository.UserRepository;
import com.ridehail.userservice.service.AccountService;

@Service
public class AccountServiceImpl implements AccountService {

    private static final Logger log = LoggerFactory.getLogger(AccountServiceImpl.class);

    static final int MAX_EMERGENCY_CONTACTS = 3;

    private final UserRepository userRepository;

    private final EmergencyContactRepository contactRepository;

    private final PasswordEncoder passwordEncoder;

    public AccountServiceImpl(UserRepository userRepository, EmergencyContactRepository contactRepository,
            PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.contactRepository = contactRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void changePassword(UUID userId, ChangePasswordRequest request) {
        MDC.put("userId", userId.toString());
        MDC.put("action", "CHANGE_PASSWORD");
        User user = requireUser(userId);
        if (!this.passwordEncoder.matches(request.getCurrentPassword(), user.getPasswordHash())) {
            throw new BadRequestException("Mật khẩu hiện tại không đúng");
        }
        if (this.passwordEncoder.matches(request.getNewPassword(), user.getPasswordHash())) {
            throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại");
        }
        user.setPasswordHash(this.passwordEncoder.encode(request.getNewPassword()));
        this.userRepository.save(user);
        log.info("Đổi mật khẩu thành công");
    }

    @Override
    @Transactional(readOnly = true)
    public List<EmergencyContactResponse> emergencyContacts(UUID userId) {
        return this.contactRepository.findByUserIdOrderByCreatedAtAsc(userId)
            .stream()
            .map(EmergencyContactResponse::of)
            .toList();
    }

    @Override
    @Transactional
    public EmergencyContactResponse addEmergencyContact(UUID userId, EmergencyContactRequest request) {
        User user = requireUser(userId);
        String phone = request.getPhone().trim();
        if (phone.equals(user.getPhone())) {
            throw new BadRequestException("Không thể dùng số điện thoại của chính bạn làm liên hệ khẩn cấp");
        }
        if (this.contactRepository.countByUserId(userId) >= MAX_EMERGENCY_CONTACTS) {
            throw new ConflictException("Chỉ lưu tối đa " + MAX_EMERGENCY_CONTACTS + " liên hệ khẩn cấp");
        }
        if (this.contactRepository.existsByUserIdAndPhone(userId, phone)) {
            throw new ConflictException("Số điện thoại này đã có trong danh sách");
        }
        String relationship = request.getRelationship() == null || request.getRelationship().isBlank() ? null
                : request.getRelationship().trim();
        EmergencyContact saved = this.contactRepository
            .save(new EmergencyContact(userId, request.getName().trim(), phone, relationship));
        return EmergencyContactResponse.of(saved);
    }

    @Override
    @Transactional
    public void deleteEmergencyContact(UUID userId, UUID contactId) {
        EmergencyContact contact = this.contactRepository.findByIdAndUserId(contactId, userId)
            .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy liên hệ khẩn cấp"));
        this.contactRepository.delete(contact);
    }

    private User requireUser(UUID userId) {
        return this.userRepository.findById(userId)
            .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy user với ID: " + userId));
    }

}
