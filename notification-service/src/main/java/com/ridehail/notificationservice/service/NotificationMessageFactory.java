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
import com.ridehail.notificationservice.dto.event.TripAcceptedPayload;
import com.ridehail.notificationservice.dto.event.TripCompensatedPayload;
import com.ridehail.notificationservice.dto.event.TripFailedPayload;
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

    public static final String TYPE_TRIP_FAILED = "TRIP_FAILED";

    public static final String TYPE_TRIP_ACCEPTED = "TRIP_ACCEPTED";

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
        String trip = shortId(payload.tripId());
        String amount = formatVnd(payload.amount());
        String content = switch (String.valueOf(payload.paymentMethod())) {
            case "BANK" -> "Chuyến " + trip + " đã hoàn thành. Thanh toán thành công " + amount + " qua ngân hàng.";
            case "CASH" -> "Chuyến " + trip + " đã hoàn thành. Thanh toán thành công " + amount + " bằng tiền mặt.";
            default -> "Thanh toán thành công " + amount + " cho chuyến " + trip + ".";
        };
        return List
            .of(new NotificationDraft(payload.riderId(), RecipientRole.PASSENGER, TYPE_PAYMENT_SUCCEEDED, content));
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

    public List<NotificationDraft> tripAccepted(TripAcceptedPayload payload) {
        return List.of(new NotificationDraft(payload.riderId(), RecipientRole.PASSENGER, TYPE_TRIP_ACCEPTED,
                "Tài xế đã nhận chuyến " + shortId(payload.tripId()) + ". Chuyến đi đã bắt đầu."));
    }

    public List<NotificationDraft> tripFailed(TripFailedPayload payload) {
        if ("INSUFFICIENT_FUNDS".equals(payload.reason())) {
            return List.of(new NotificationDraft(payload.riderId(), RecipientRole.PASSENGER, TYPE_TRIP_FAILED, "Chuyến "
                    + shortId(payload.tripId())
                    + " không được thực hiện vì số dư tài khoản ngân hàng không đủ. Vui lòng nạp thêm tiền rồi đặt lại."));
        }
        return List.of(new NotificationDraft(payload.riderId(), RecipientRole.PASSENGER, TYPE_TRIP_FAILED, "Chuyến "
                + shortId(payload.tripId()) + " thất bại vì không còn tài xế khả dụng. Vui lòng đặt lại chuyến."));
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
