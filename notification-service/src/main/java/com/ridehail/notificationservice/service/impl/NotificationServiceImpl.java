package com.ridehail.notificationservice.service.impl;

import java.util.List;
import java.util.UUID;

import com.ridehail.notificationservice.dto.NotificationDraft;
import com.ridehail.notificationservice.dto.response.NotificationResponse;
import com.ridehail.notificationservice.entity.Notification;
import com.ridehail.notificationservice.entity.NotificationChannel;
import com.ridehail.notificationservice.entity.ProcessedEvent;
import com.ridehail.notificationservice.mapper.NotificationMapper;
import com.ridehail.notificationservice.messaging.EventEnvelope;
import com.ridehail.notificationservice.repository.NotificationRepository;
import com.ridehail.notificationservice.repository.ProcessedEventRepository;
import com.ridehail.notificationservice.service.NotificationSender;
import com.ridehail.notificationservice.service.NotificationService;
import com.ridehail.notificationservice.simulation.FaultInjector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationServiceImpl implements NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationServiceImpl.class);

    private final NotificationRepository notificationRepository;

    private final ProcessedEventRepository processedEventRepository;

    private final NotificationSender notificationSender;

    private final FaultInjector faultInjector;

    public NotificationServiceImpl(NotificationRepository notificationRepository,
            ProcessedEventRepository processedEventRepository, NotificationSender notificationSender,
            FaultInjector faultInjector) {
        this.notificationRepository = notificationRepository;
        this.processedEventRepository = processedEventRepository;
        this.notificationSender = notificationSender;
        this.faultInjector = faultInjector;
    }

    @Override
    @Transactional
    public int notify(EventEnvelope envelope, UUID tripId, List<NotificationDraft> drafts) {
        if (this.processedEventRepository.existsById(envelope.eventId())) {
            log.info("Bỏ qua event trùng: eventId={} đã được xử lý", envelope.eventId());
            return 0;
        }
        // Lỗi tạm thời ném exception để listener retry; transaction rollback nên chưa có
        // gì được ghi
        this.faultInjector.beforeExternalCall("kênh gửi thông báo");
        for (NotificationDraft draft : drafts) {
            Notification notification = this.notificationRepository.save(
                    new Notification(draft.recipientId(), draft.recipientRole(), draft.type(), NotificationChannel.LOG,
                            draft.content(), envelope.eventId(), tripId, envelope.correlationId()));
            this.notificationSender.send(notification);
        }
        this.processedEventRepository.save(new ProcessedEvent(envelope.eventId(), envelope.eventType()));
        return drafts.size();
    }

    @Override
    @Transactional(readOnly = true)
    public List<NotificationResponse> getNotificationsOf(UUID recipientId, int limit) {
        return this.notificationRepository.findByRecipientIdOrderByCreatedAtDesc(recipientId, PageRequest.of(0, limit))
            .stream()
            .map(NotificationMapper::toResponse)
            .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<NotificationResponse> findNotificationsOfTrip(UUID tripId) {
        return this.notificationRepository.findByTripIdOrderByCreatedAtAsc(tripId)
            .stream()
            .map(NotificationMapper::toResponse)
            .toList();
    }

}
