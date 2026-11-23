package com.ridehail.paymentservice.service.impl;

import java.time.Instant;
import java.util.UUID;

import com.ridehail.paymentservice.dto.event.PaymentAuthorizationFailedPayload;
import com.ridehail.paymentservice.dto.event.PaymentAuthorizedPayload;
import com.ridehail.paymentservice.dto.event.TripClosedPayload;
import com.ridehail.paymentservice.dto.event.TripRequestedPayload;
import com.ridehail.paymentservice.entity.ClosedTrip;
import com.ridehail.paymentservice.entity.PaymentFailureReason;
import com.ridehail.paymentservice.entity.PaymentMethod;
import com.ridehail.paymentservice.entity.ProcessedEvent;
import com.ridehail.paymentservice.messaging.EventEnvelope;
import com.ridehail.paymentservice.messaging.EventTypes;
import com.ridehail.paymentservice.messaging.InvalidEventException;
import com.ridehail.paymentservice.messaging.OutboxWriter;
import com.ridehail.paymentservice.repository.ClosedTripRepository;
import com.ridehail.paymentservice.repository.ProcessedEventRepository;
import com.ridehail.paymentservice.service.BankService;
import com.ridehail.paymentservice.service.HoldOutcome;
import com.ridehail.paymentservice.service.PaymentAuthorizationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentAuthorizationServiceImpl implements PaymentAuthorizationService {

    private static final Logger log = LoggerFactory.getLogger(PaymentAuthorizationServiceImpl.class);

    private static final int MAX_REASON_LENGTH = 40;

    private final BankService bankService;

    private final ClosedTripRepository closedTripRepository;

    private final ProcessedEventRepository processedEventRepository;

    private final OutboxWriter outboxWriter;

    public PaymentAuthorizationServiceImpl(BankService bankService, ClosedTripRepository closedTripRepository,
            ProcessedEventRepository processedEventRepository, OutboxWriter outboxWriter) {
        this.bankService = bankService;
        this.closedTripRepository = closedTripRepository;
        this.processedEventRepository = processedEventRepository;
        this.outboxWriter = outboxWriter;
    }

    @Override
    @Transactional
    public void handleTripRequested(EventEnvelope envelope, TripRequestedPayload payload) {
        PaymentMethod method = payload.resolvedMethod();
        UUID riderId = payload.resolvedRiderId();
        if (riderId == null) {
            throw new InvalidEventException("Payload of trip.requested requires riderId");
        }
        if (this.processedEventRepository.existsById(envelope.eventId())) {
            log.info("Bỏ qua event trùng: eventId={} đã được xử lý", envelope.eventId());
            return;
        }
        UUID tripId = payload.tripId();
        if (this.closedTripRepository.existsById(tripId)) {
            log.info("Chuyến đã hủy/thất bại trước khi kịp khoá tiền, không khoá");
        }
        else if (method == PaymentMethod.CASH) {
            authorize(envelope, payload, riderId, PaymentMethod.CASH, null);
        }
        else {
            HoldOutcome outcome = this.bankService.hold(tripId, riderId, payload.fareAmount());
            switch (outcome.decision()) {
                case HELD -> authorize(envelope, payload, riderId, PaymentMethod.BANK, outcome.hold().getId());
                case ALREADY_HELD -> log.info("Chuyến đã được khoá tiền từ trước, không phát lại payment.authorized");
                case INSUFFICIENT_FUNDS -> {
                    this.outboxWriter.enqueue(EventTypes.PAYMENT_AUTHORIZATION_FAILED, tripId, envelope.correlationId(),
                            new PaymentAuthorizationFailedPayload(tripId, riderId, payload.fareAmount(),
                                    PaymentFailureReason.INSUFFICIENT_FUNDS, Instant.now()));
                    log.info("Không khoá được {}: số dư không đủ", payload.fareAmount());
                }
            }
        }
        this.processedEventRepository.save(new ProcessedEvent(envelope.eventId(), envelope.eventType()));
    }

    @Override
    @Transactional
    public void handleTripClosed(EventEnvelope envelope, TripClosedPayload payload) {
        if (this.processedEventRepository.existsById(envelope.eventId())) {
            log.info("Bỏ qua event trùng: eventId={} đã được xử lý", envelope.eventId());
            return;
        }
        UUID tripId = payload.tripId();
        boolean released = this.bankService.release(tripId);
        if (!released && !this.closedTripRepository.existsById(tripId)) {
            String reason = (payload.reason() != null && !payload.reason().isBlank()) ? payload.reason()
                    : envelope.eventType();
            this.closedTripRepository
                .save(new ClosedTrip(tripId, reason.substring(0, Math.min(reason.length(), MAX_REASON_LENGTH))));
        }
        log.info("Chuyến kết thúc không hoàn thành ({}): {}", envelope.eventType(),
                released ? "đã mở khoá tiền" : "không có khoản khoá");
        this.processedEventRepository.save(new ProcessedEvent(envelope.eventId(), envelope.eventType()));
    }

    private void authorize(EventEnvelope envelope, TripRequestedPayload payload, UUID riderId, PaymentMethod method,
            UUID holdId) {
        this.outboxWriter.enqueue(EventTypes.PAYMENT_AUTHORIZED, payload.tripId(), envelope.correlationId(),
                new PaymentAuthorizedPayload(payload.tripId(), riderId, payload.fareAmount(), method, holdId,
                        Instant.now()));
        log.info("Đã xác nhận thanh toán {} cho {}", method, payload.fareAmount());
    }

}
