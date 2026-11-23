package com.ridehail.paymentservice.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.ridehail.paymentservice.dto.response.BankAccountResponse;
import com.ridehail.paymentservice.dto.response.BankTransactionResponse;

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

    CaptureOutcome capture(UUID tripId, UUID userId, BigDecimal amount);

    BankAccountResponse account(UUID userId);

    List<BankTransactionResponse> transactions(UUID userId, int limit);

    BankAccountResponse topUp(UUID userId, BigDecimal amount);

    /**
     * Đặt số dư về một giá trị cố định. Chỉ dùng cho script kiểm thử (API nội bộ).
     */
    BankAccountResponse setBalance(UUID userId, BigDecimal balance);

    /**
     * @return số khoản quá hạn vừa được mở
     */
    int expireHolds(Instant now);

}
