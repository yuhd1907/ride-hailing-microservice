package com.ridehail.paymentservice.service.impl;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.config.exception.ConflictException;
import com.ridehail.paymentservice.config.exception.ForbiddenException;
import com.ridehail.paymentservice.config.exception.ResourceNotFoundException;
import com.ridehail.paymentservice.dto.event.PaymentFailedPayload;
import com.ridehail.paymentservice.dto.event.PaymentSucceededPayload;
import com.ridehail.paymentservice.dto.event.TripCompletedPayload;
import com.ridehail.paymentservice.dto.response.PaymentResponse;
import com.ridehail.paymentservice.entity.Payment;
import com.ridehail.paymentservice.entity.PaymentFailureReason;
import com.ridehail.paymentservice.entity.PaymentMethod;
import com.ridehail.paymentservice.entity.PaymentStatus;
import com.ridehail.paymentservice.entity.ProcessedEvent;
import com.ridehail.paymentservice.mapper.PaymentMapper;
import com.ridehail.paymentservice.messaging.EventEnvelope;
import com.ridehail.paymentservice.messaging.EventTypes;
import com.ridehail.paymentservice.messaging.OutboxWriter;
import com.ridehail.paymentservice.repository.PaymentRepository;
import com.ridehail.paymentservice.repository.ProcessedEventRepository;
import com.ridehail.paymentservice.service.BankService;
import com.ridehail.paymentservice.service.CaptureOutcome;
import com.ridehail.paymentservice.service.PaymentService;
import com.ridehail.paymentservice.simulation.FaultInjector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentServiceImpl implements PaymentService {

    private static final Logger log = LoggerFactory.getLogger(PaymentServiceImpl.class);

    private final PaymentRepository paymentRepository;

    private final ProcessedEventRepository processedEventRepository;

    private final OutboxWriter outboxWriter;

    private final BankService bankService;

    private final FaultInjector faultInjector;

    public PaymentServiceImpl(PaymentRepository paymentRepository, ProcessedEventRepository processedEventRepository,
            OutboxWriter outboxWriter, BankService bankService, FaultInjector faultInjector) {
        this.paymentRepository = paymentRepository;
        this.processedEventRepository = processedEventRepository;
        this.outboxWriter = outboxWriter;
        this.bankService = bankService;
        this.faultInjector = faultInjector;
    }

    @Override
    @Transactional
    public void handleTripCompleted(EventEnvelope envelope, TripCompletedPayload payload) {
        PaymentMethod method = payload.resolvedMethod();
        // 1. Deduplication: cùng một message bị RabbitMQ giao lại
        if (this.processedEventRepository.existsById(envelope.eventId())) {
            log.info("Bỏ qua event trùng: eventId={} đã được xử lý", envelope.eventId());
            return;
        }
        // 2. Idempotency: Trip Service publish lại cho cùng chuyến với eventId mới
        Optional<Payment> existing = this.paymentRepository.findByIdempotencyKey(payload.tripId());
        if (existing.isPresent()) {
            log.info("Chuyến đã có payment {} ({}), không thu tiền lần hai", existing.get().getId(),
                    existing.get().getStatus());
            this.processedEventRepository.save(new ProcessedEvent(envelope.eventId(), envelope.eventType()));
            return;
        }
        // 3. Lỗi tạm thời giả lập ném exception để listener retry; transaction rollback
        // nên
        // chưa có gì được ghi.
        this.faultInjector.beforeExternalCall("ngân hàng");
        UUID riderId = payload.resolvedRiderId();
        Payment payment = new Payment(payload.tripId(), riderId, payload.driverId(), payload.fareAmount(),
                payload.tripId(), envelope.correlationId(), method);
        if (method == PaymentMethod.CASH) {
            // Tiền mặt: chờ tài xế xác nhận đã nhận tiền (confirmCash) mới phát
            // payment.succeeded
            this.paymentRepository.saveAndFlush(payment);
            this.processedEventRepository.save(new ProcessedEvent(envelope.eventId(), envelope.eventType()));
            log.info("Chuyến trả tiền mặt {}: chờ tài xế xác nhận", payment.getAmount());
            return;
        }
        // 4. Ngân hàng: trừ khoản đã khoá khi đặt chuyến (không còn khoản khoá thì trừ
        // trực tiếp)
        CaptureOutcome outcome = this.bankService.capture(payload.tripId(), riderId, payload.fareAmount());
        if (outcome == CaptureOutcome.CAPTURED) {
            payment.markSucceeded();
        }
        else {
            payment.markFailed(PaymentFailureReason.INSUFFICIENT_FUNDS);
        }
        // UNIQUE(idempotency_key) chặn hai consumer cùng tạo payment cho một chuyến;
        // bên thua nhận lỗi, retry và rơi vào nhánh idempotency ở bước 2.
        payment = this.paymentRepository.saveAndFlush(payment);
        this.processedEventRepository.save(new ProcessedEvent(envelope.eventId(), envelope.eventType()));
        // 5. Ghi event kết quả vào outbox cùng transaction (Outbox pattern)
        if (payment.getStatus() == PaymentStatus.SUCCESS) {
            queueSucceeded(payment, envelope.correlationId());
        }
        else {
            this.outboxWriter.enqueue(EventTypes.PAYMENT_FAILED, payment.getTripId(), envelope.correlationId(),
                    new PaymentFailedPayload(payment.getId(), payment.getTripId(), payment.getRiderId(),
                            payment.getDriverId(), payment.getAmount(), payment.getFailureReason(), Instant.now()));
            log.info("Thanh toán thất bại: paymentId={}, amount={}, reason={}", payment.getId(), payment.getAmount(),
                    payment.getFailureReason());
        }
    }

    @Override
    @Transactional
    public PaymentResponse confirmCash(UUID tripId, UUID driverId) {
        Payment payment = this.paymentRepository.findByIdempotencyKey(tripId)
            .orElseThrow(() -> new ResourceNotFoundException("Chuyến " + tripId + " chưa có payment"));
        if (!driverId.equals(payment.getDriverId())) {
            throw new ForbiddenException("Chỉ tài xế của chuyến mới xác nhận được tiền mặt");
        }
        if (payment.getMethod() != PaymentMethod.CASH) {
            throw new ConflictException("Chuyến này không thanh toán bằng tiền mặt");
        }
        if (payment.getStatus() == PaymentStatus.PENDING) {
            payment.markSucceeded();
            this.paymentRepository.save(payment);
            queueSucceeded(payment, payment.getCorrelationId());
        }
        return PaymentMapper.toResponse(payment);
    }

    @Override
    @Transactional(readOnly = true)
    public PaymentResponse getPayment(UUID paymentId, UUID requesterId) {
        Payment payment = this.paymentRepository.findById(paymentId)
            .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy payment " + paymentId));
        return PaymentMapper.toResponse(checkOwner(payment, requesterId));
    }

    @Override
    @Transactional(readOnly = true)
    public PaymentResponse getPaymentOfTrip(UUID tripId, UUID requesterId) {
        Payment payment = this.paymentRepository.findByIdempotencyKey(tripId)
            .orElseThrow(() -> new ResourceNotFoundException("Chuyến " + tripId + " chưa có payment"));
        return PaymentMapper.toResponse(checkOwner(payment, requesterId));
    }

    @Override
    @Transactional(readOnly = true)
    public List<PaymentResponse> getPaymentsOfRider(UUID riderId, int limit) {
        return this.paymentRepository.findByRiderIdOrderByCreatedAtDesc(riderId, PageRequest.of(0, limit))
            .stream()
            .map(PaymentMapper::toResponse)
            .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<PaymentResponse> findPaymentsOfTrip(UUID tripId) {
        return this.paymentRepository.findByTripIdOrderByCreatedAtAsc(tripId)
            .stream()
            .map(PaymentMapper::toResponse)
            .toList();
    }

    private void queueSucceeded(Payment payment, String correlationId) {
        this.outboxWriter.enqueue(EventTypes.PAYMENT_SUCCEEDED, payment.getTripId(), correlationId,
                new PaymentSucceededPayload(payment.getId(), payment.getTripId(), payment.getRiderId(),
                        payment.getDriverId(), payment.getAmount(), Instant.now(), payment.getMethod()));
        log.info("Thanh toán thành công ({}): paymentId={}, amount={}", payment.getMethod(), payment.getId(),
                payment.getAmount());
    }

    private Payment checkOwner(Payment payment, UUID requesterId) {
        if (!payment.getRiderId().equals(requesterId)) {
            throw new ForbiddenException("Không có quyền xem payment của người dùng khác");
        }
        return payment;
    }

}
