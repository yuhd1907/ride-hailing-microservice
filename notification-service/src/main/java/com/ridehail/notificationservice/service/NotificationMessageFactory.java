package com.ridehail.notificationservice.service;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.ridehail.notificationservice.dto.NotificationDraft;
import com.ridehail.notificationservice.dto.event.DriverAssignedPayload;
import com.ridehail.notificationservice.dto.event.PaymentFailedPayload;
import com.ridehail.notificationservice.dto.event.PaymentSucceededPayload;
import com.ridehail.notificationservice.dto.event.TripCompensatedPayload;
import com.ridehail.notificationservice.entity.RecipientRole;
import org.springframework.stereotype.Component;

/**
 * Soạn nội dung thông báo cho hành khách và tài xế từ từng loại event.
 */
@Component
public class NotificationMessageFactory {

    public static final String TYPE_DRIVER_ASSIGNED = "DRIVER_ASSIGNED";

    public static final String TYPE_PAYMENT_SUCCEEDED = "PAYMENT_SUCCEEDED";

    public static final String TYPE_PAYMENT_FAILED = "PAYMENT_FAILED";

    public static final String TYPE_TRIP_COMPENSATED = "TRIP_COMPENSATED";

    private static final Locale VIETNAMESE = Locale.forLanguageTag("vi-VN");

    public List<NotificationDraft> driverAssigned(DriverAssignedPayload payload) {
        String trip = shortId(payload.tripId());
        return List.of(
                new NotificationDraft(payload.resolvedRiderId(), RecipientRole.PASSENGER, TYPE_DRIVER_ASSIGNED,
                        "Đã tìm được tài xế cho chuyến " + trip + ". Tài xế đang đến điểm đón."),
                new NotificationDraft(payload.driverId(), RecipientRole.DRIVER, TYPE_DRIVER_ASSIGNED,
                        "Bạn được ghép với chuyến " + trip + ". Hãy đến điểm đón khách."));
    }

    public List<NotificationDraft> paymentSucceeded(PaymentSucceededPayload payload) {
        return List.of(new NotificationDraft(payload.riderId(), RecipientRole.PASSENGER, TYPE_PAYMENT_SUCCEEDED,
                "Thanh toán thành công " + formatVnd(payload.amount()) + " cho chuyến " + shortId(payload.tripId())
                        + "."));
    }

    public List<NotificationDraft> paymentFailed(PaymentFailedPayload payload) {
        return List.of(new NotificationDraft(payload.riderId(), RecipientRole.PASSENGER, TYPE_PAYMENT_FAILED,
                "Thanh toán " + formatVnd(payload.amount()) + " cho chuyến " + shortId(payload.tripId()) + " thất bại ("
                        + describeReason(payload.reason()) + ")."));
    }

    public List<NotificationDraft> tripCompensated(TripCompensatedPayload payload) {
        String trip = shortId(payload.tripId());
        String reason = describeReason(payload.reason());
        List<NotificationDraft> drafts = new ArrayList<>();
        drafts.add(new NotificationDraft(payload.resolvedRiderId(), RecipientRole.PASSENGER, TYPE_TRIP_COMPENSATED,
                "Chuyến " + trip + " đã được hủy và hoàn tác do thanh toán không thành công (" + reason + ")."));
        if (payload.driverId() != null) {
            drafts.add(new NotificationDraft(payload.driverId(), RecipientRole.DRIVER, TYPE_TRIP_COMPENSATED, "Chuyến "
                    + trip + " đã bị hủy do khách thanh toán không thành công. Bạn đã sẵn sàng nhận chuyến mới."));
        }
        return drafts;
    }

    static String formatVnd(BigDecimal amount) {
        NumberFormat format = NumberFormat.getNumberInstance(VIETNAMESE);
        format.setMaximumFractionDigits(0);
        return format.format(amount) + " VND";
    }

    static String describeReason(String reason) {
        if (reason == null) {
            return "không rõ lý do";
        }
        return switch (reason) {
            case "INSUFFICIENT_FUNDS" -> "số dư không đủ";
            case "PAYMENT_DECLINED" -> "giao dịch bị từ chối";
            case "INTERNAL_ERROR" -> "lỗi hệ thống thanh toán";
            default -> reason;
        };
    }

    private static String shortId(UUID id) {
        String value = String.valueOf(id);
        return (value.length() > 8) ? value.substring(0, 8) : value;
    }

}
