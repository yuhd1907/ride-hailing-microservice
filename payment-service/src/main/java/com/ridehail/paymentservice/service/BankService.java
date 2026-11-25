package com.ridehail.paymentservice.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.ridehail.paymentservice.dto.response.BankAccountResponse;
import com.ridehail.paymentservice.dto.response.BankTransactionResponse;
import com.ridehail.paymentservice.dto.response.WalletPolicyResponse;

/**
 * Ngân hàng ảo của hành khách: tạm khoá tiền khi đặt chuyến, mở khoá khi chuyến không
 * thành, trừ tiền khi chuyến kết thúc. Tài khoản tự tạo với số dư khởi tạo ở lần dùng
 * đầu.
 */
public interface BankService {

    HoldOutcome hold(UUID tripId, UUID userId, BigDecimal amount);

    /**
     * @return true nếu chuyến có khoản đang khoá và khoản đó vừa được mở
     */
    boolean release(UUID tripId);

    /**
     * Chuyến bị hủy hoặc thất bại: khoá tài khoản của khách rồi mở khoản đang khoá; nếu
     * chuyến chưa có khoản khoá thì ghi nhận chuyến đã đóng để trip.requested tới sau
     * không khoá nữa.
     * @return true nếu có khoản đang khoá vừa được mở
     */
    boolean closeTrip(UUID tripId, UUID userId, String reason);

    CaptureOutcome capture(UUID tripId, UUID userId, BigDecimal amount);

    BankAccountResponse account(UUID userId);

    List<BankTransactionResponse> transactions(UUID userId, int limit);

    BankAccountResponse topUp(UUID userId, BigDecimal amount);

    /**
     * Quyết toán chuyến cho tài xế khi thanh toán thành công. BANK: cộng tiền cước sau khi
     * trừ chiết khấu (EARNING). CASH: tài xế đã cầm tiền mặt nên trừ chiết khấu khỏi ví
     * (COMMISSION). Gọi lại cho cùng chuyến không ghi thêm.
     */
    void settleDriver(UUID tripId, UUID driverId, BigDecimal fare, boolean paidByCash);

    /**
     * Tài xế rút tiền khả dụng trong ví về ngân hàng liên kết.
     */
    BankAccountResponse withdraw(UUID userId, BigDecimal amount);

    WalletPolicyResponse walletPolicy();

    /**
     * Chuyển tip từ tài khoản khách sang ví tài xế trong cùng transaction; mỗi chuyến một lần.
     */
    com.ridehail.paymentservice.dto.response.TipResponse tip(UUID tripId, UUID riderId, UUID driverId,
            BigDecimal amount);

    com.ridehail.paymentservice.dto.response.TipResponse tipOf(UUID tripId, UUID riderId);

    /**
     * Đặt số dư về một giá trị cố định. Chỉ dùng cho script kiểm thử (API nội bộ).
     */
    BankAccountResponse setBalance(UUID userId, BigDecimal balance);

    /**
     * Các chuyến có khoản khoá đã quá hạn (tối đa một lô). Người gọi mở từng khoản bằng
     * {@link #release(UUID)}, mỗi lần một transaction.
     */
    List<UUID> expiredHoldTrips(Instant now);

}
