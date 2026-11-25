package com.ridehail.paymentservice.service.impl;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.dto.response.BankAccountResponse;
import com.ridehail.paymentservice.config.exception.ConflictException;
import com.ridehail.paymentservice.dto.response.BankTransactionResponse;
import com.ridehail.paymentservice.dto.response.WalletPolicyResponse;
import com.ridehail.paymentservice.entity.BankAccount;
import com.ridehail.paymentservice.entity.BankTransaction;
import com.ridehail.paymentservice.entity.BankTransactionType;
import com.ridehail.paymentservice.entity.ClosedTrip;
import com.ridehail.paymentservice.entity.FundHold;
import com.ridehail.paymentservice.entity.HoldStatus;
import com.ridehail.paymentservice.repository.BankAccountRepository;
import com.ridehail.paymentservice.repository.BankTransactionRepository;
import com.ridehail.paymentservice.repository.ClosedTripRepository;
import com.ridehail.paymentservice.repository.FundHoldRepository;
import com.ridehail.paymentservice.service.BankService;
import com.ridehail.paymentservice.service.CaptureOutcome;
import com.ridehail.paymentservice.service.HoldOutcome;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Mọi thao tác thay đổi tiền đều khoá dòng tài khoản (FOR UPDATE) <b>trước</b> khi đọc
 * khoản khoá, closed_trips hay tổng đang khoá. Nhờ vậy các transaction trên cùng một
 * khách chạy tuần tự và luôn thấy kết quả đã commit của nhau.
 */
@Service
public class BankServiceImpl implements BankService {

    private static final Logger log = LoggerFactory.getLogger(BankServiceImpl.class);

    static final BigDecimal MIN_TOP_UP = new BigDecimal("1000");

    static final BigDecimal MAX_TOP_UP = new BigDecimal("5000000");

    static final BigDecimal MAX_BALANCE = new BigDecimal("1000000000");

    private static final int EXPIRY_BATCH = 100;

    private static final int MAX_LIMIT = 100;

    private static final int MAX_REASON_LENGTH = 40;

    private final BankAccountRepository accountRepository;

    private final FundHoldRepository holdRepository;

    private final BankTransactionRepository transactionRepository;

    private final ClosedTripRepository closedTripRepository;

    private final BigDecimal initialBalance;

    private final Duration holdTtl;

    static final BigDecimal DEFAULT_COMMISSION_RATE = new BigDecimal("0.20");

    static final BigDecimal MIN_WITHDRAW = new BigDecimal("50000");

    static final BigDecimal MAX_WITHDRAW = new BigDecimal("20000000");

    static final BigDecimal MIN_TIP = new BigDecimal("5000");

    static final BigDecimal MAX_TIP = new BigDecimal("500000");

    /** Tỷ lệ chiết khấu nền tảng trên mỗi chuyến của tài xế (0.20 = 20%). */
    private BigDecimal commissionRate = DEFAULT_COMMISSION_RATE;

    public BankServiceImpl(BankAccountRepository accountRepository, FundHoldRepository holdRepository,
            BankTransactionRepository transactionRepository, ClosedTripRepository closedTripRepository,
            @Value("${payment.bank.initial-balance:500000}") BigDecimal initialBalance,
            @Value("${payment.bank.hold-ttl:PT2H}") Duration holdTtl) {
        this.accountRepository = accountRepository;
        this.holdRepository = holdRepository;
        this.transactionRepository = transactionRepository;
        this.closedTripRepository = closedTripRepository;
        this.initialBalance = initialBalance;
        this.holdTtl = holdTtl;
    }

    @Value("${payment.driver.commission-rate:0.20}")
    void setCommissionRate(BigDecimal rate) {
        if (rate == null || rate.signum() < 0 || rate.compareTo(BigDecimal.ONE) >= 0) {
            throw new IllegalArgumentException("payment.driver.commission-rate phải trong [0, 1)");
        }
        this.commissionRate = rate;
    }

    @Override
    @Transactional
    public void settleDriver(UUID tripId, UUID driverId, BigDecimal fare, boolean paidByCash) {
        if (driverId == null || fare == null || fare.signum() <= 0) {
            return;
        }
        BankTransactionType type = paidByCash ? BankTransactionType.COMMISSION : BankTransactionType.EARNING;
        BankAccount account = lockAccount(driverId);
        if (this.transactionRepository.existsByTripIdAndUserIdAndType(tripId, driverId, type)) {
            log.info("Chuyến đã được quyết toán cho tài xế ({}), bỏ qua", type);
            return;
        }
        // Chiết khấu làm tròn tới đồng; tiền tài xế nhận = cước - chiết khấu
        BigDecimal commission = fare.multiply(this.commissionRate).setScale(0, RoundingMode.HALF_UP);
        if (paidByCash) {
            if (commission.signum() == 0) {
                return;
            }
            account.debit(commission);
            record(account, BankTransactionType.COMMISSION, commission, tripId, available(account));
            log.info("Trừ chiết khấu {} của chuyến tiền mặt khỏi ví tài xế, số dư còn {}", commission,
                    account.getBalance());
        }
        else {
            BigDecimal net = fare.subtract(commission);
            account.credit(net);
            record(account, BankTransactionType.EARNING, net, tripId, available(account));
            log.info("Cộng {} (cước {} - chiết khấu {}) vào ví tài xế", net, fare, commission);
        }
    }

    @Override
    @Transactional
    public BankAccountResponse withdraw(UUID userId, BigDecimal amount) {
        if (amount == null || amount.compareTo(MIN_WITHDRAW) < 0 || amount.compareTo(MAX_WITHDRAW) > 0) {
            throw new IllegalArgumentException("Số tiền rút phải từ 50.000 đến 20.000.000 VND");
        }
        BankAccount account = lockAccount(userId);
        BigDecimal available = available(account);
        if (available.compareTo(amount) < 0) {
            throw new ConflictException("Số dư khả dụng " + available.toPlainString() + " VND không đủ để rút");
        }
        account.debit(amount);
        record(account, BankTransactionType.WITHDRAW, amount, null, available.subtract(amount));
        log.info("Tài xế rút {} về ngân hàng liên kết", amount);
        return toResponse(account);
    }

    @Override
    public WalletPolicyResponse walletPolicy() {
        return new WalletPolicyResponse(this.commissionRate, MIN_WITHDRAW, MAX_WITHDRAW);
    }

    @Override
    @Transactional
    public com.ridehail.paymentservice.dto.response.TipResponse tip(UUID tripId, UUID riderId, UUID driverId,
            BigDecimal amount) {
        if (amount == null || amount.compareTo(MIN_TIP) < 0 || amount.compareTo(MAX_TIP) > 0) {
            throw new IllegalArgumentException("Tip phải từ 5.000 đến 500.000 VND");
        }
        // Khoá tài khoản khách trước rồi tới ví tài xế, cùng thứ tự với lúc trừ cước + cộng ví,
        // nên hai transaction không khoá chéo nhau.
        BankAccount rider = lockAccount(riderId);
        if (this.transactionRepository.existsByTripIdAndUserIdAndType(tripId, riderId, BankTransactionType.TIP_SENT)) {
            throw new ConflictException("Bạn đã tip cho chuyến này rồi");
        }
        BigDecimal available = available(rider);
        if (available.compareTo(amount) < 0) {
            throw new ConflictException("Số dư khả dụng " + available.toPlainString() + " VND không đủ để tip");
        }
        BankAccount driver = lockAccount(driverId);
        rider.debit(amount);
        record(rider, BankTransactionType.TIP_SENT, amount, tripId, available.subtract(amount));
        driver.credit(amount);
        record(driver, BankTransactionType.TIP_RECEIVED, amount, tripId, available(driver));
        log.info("Khách tip {} cho tài xế", amount);
        return tipOf(tripId, riderId);
    }

    @Override
    @Transactional(readOnly = true)
    public com.ridehail.paymentservice.dto.response.TipResponse tipOf(UUID tripId, UUID riderId) {
        return this.transactionRepository.findFirstByTripIdAndUserIdAndType(tripId, riderId, BankTransactionType.TIP_SENT)
            .map((tx) -> new com.ridehail.paymentservice.dto.response.TipResponse(tripId, tx.getAmount(), tx.getCreatedAt()))
            .orElseGet(() -> new com.ridehail.paymentservice.dto.response.TipResponse(tripId, null, null));
    }

    @Override
    @Transactional
    public HoldOutcome hold(UUID tripId, UUID userId, BigDecimal amount) {
        BankAccount account = lockAccount(userId);
        Optional<FundHold> existing = this.holdRepository.findByTripId(tripId);
        if (existing.isPresent()) {
            return new HoldOutcome(HoldOutcome.Decision.ALREADY_HELD, existing.get());
        }
        if (this.closedTripRepository.existsById(tripId)) {
            log.info("Chuyến đã hủy/thất bại trước khi kịp khoá tiền, không khoá");
            return new HoldOutcome(HoldOutcome.Decision.TRIP_CLOSED, null);
        }
        BigDecimal available = available(account);
        if (available.compareTo(amount) < 0) {
            log.info("Không đủ số dư để khoá {}: khả dụng {}", amount, available);
            // Ghi nhận để một lần giao lại trip.requested (eventId mới) không khoá lại
            // hay phát thêm event
            recordClosed(tripId, "INSUFFICIENT_FUNDS");
            return new HoldOutcome(HoldOutcome.Decision.INSUFFICIENT_FUNDS, null);
        }
        FundHold hold = new FundHold(tripId, userId, amount, Instant.now().plus(this.holdTtl));
        this.holdRepository.save(hold);
        record(account, BankTransactionType.HOLD, amount, tripId, available.subtract(amount));
        log.info("Đã khoá {} cho chuyến, khả dụng còn {}", amount, available.subtract(amount));
        return new HoldOutcome(HoldOutcome.Decision.HELD, hold);
    }

    @Override
    @Transactional
    public boolean release(UUID tripId) {
        Optional<UUID> owner = this.holdRepository.findUserIdByTripId(tripId);
        if (owner.isEmpty()) {
            return false;
        }
        return releaseLocked(lockAccount(owner.get()), tripId);
    }

    @Override
    @Transactional
    public boolean closeTrip(UUID tripId, UUID userId, String reason) {
        UUID owner = (userId != null) ? userId : this.holdRepository.findUserIdByTripId(tripId).orElse(null);
        if (owner == null) {
            recordClosed(tripId, reason);
            return false;
        }
        BankAccount account = lockAccount(owner);
        if (this.holdRepository.findByTripId(tripId).isPresent()) {
            return releaseLocked(account, tripId);
        }
        recordClosed(tripId, reason);
        return false;
    }

    @Override
    @Transactional
    public CaptureOutcome capture(UUID tripId, UUID userId, BigDecimal amount) {
        BankAccount account = lockAccount(userId);
        FundHold held = this.holdRepository.findByTripId(tripId)
            .filter((hold) -> hold.getStatus() == HoldStatus.HELD)
            .orElse(null);
        BigDecimal heldTotal = this.holdRepository.sumHeldByUserId(userId);
        BigDecimal heldByOthers = (held != null) ? heldTotal.subtract(held.getAmount()) : heldTotal;
        if (account.getBalance().subtract(heldByOthers).compareTo(amount) < 0) {
            if (held != null) {
                held.release();
                this.holdRepository.save(held);
                record(account, BankTransactionType.RELEASE, held.getAmount(), tripId,
                        account.getBalance().subtract(heldByOthers));
            }
            log.info("Không đủ số dư để trừ {} khi kết thúc chuyến", amount);
            return CaptureOutcome.INSUFFICIENT_FUNDS;
        }
        account.debit(amount);
        if (held != null) {
            held.capture();
            this.holdRepository.save(held);
        }
        record(account, BankTransactionType.CAPTURE, amount, tripId, account.getBalance().subtract(heldByOthers));
        log.info("Đã trừ {} ({})", amount, (held != null) ? "từ khoản đã khoá" : "trừ trực tiếp, không có khoản khoá");
        return CaptureOutcome.CAPTURED;
    }

    @Override
    @Transactional(readOnly = true)
    public BankAccountResponse account(UUID userId) {
        // Chỉ đọc: không tạo tài khoản, không khoá dòng. Khách chưa có tài khoản thấy số
        // dư khởi tạo.
        return this.accountRepository.findById(userId)
            .map(this::toResponse)
            .orElseGet(
                    () -> new BankAccountResponse(userId, this.initialBalance, BigDecimal.ZERO, this.initialBalance));
    }

    @Override
    @Transactional(readOnly = true)
    public List<BankTransactionResponse> transactions(UUID userId, int limit) {
        int pageSize = Math.max(1, Math.min(limit, MAX_LIMIT));
        return this.transactionRepository.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(0, pageSize))
            .stream()
            .map((tx) -> new BankTransactionResponse(tx.getId(), tx.getType(), tx.getAmount(), tx.getTripId(),
                    tx.getBalanceAfter(), tx.getAvailableAfter(), tx.getCreatedAt()))
            .toList();
    }

    @Override
    @Transactional
    public BankAccountResponse topUp(UUID userId, BigDecimal amount) {
        if (amount == null || amount.compareTo(MIN_TOP_UP) < 0 || amount.compareTo(MAX_TOP_UP) > 0) {
            throw new IllegalArgumentException("Số tiền nạp phải từ 1.000 đến 5.000.000 VND");
        }
        BankAccount account = lockAccount(userId);
        account.credit(amount);
        record(account, BankTransactionType.TOPUP, amount, null, available(account));
        return toResponse(account);
    }

    @Override
    @Transactional
    public BankAccountResponse setBalance(UUID userId, BigDecimal balance) {
        if (balance == null || balance.signum() < 0 || balance.compareTo(MAX_BALANCE) > 0) {
            throw new IllegalArgumentException("Số dư phải từ 0 đến 1.000.000.000 VND");
        }
        BankAccount account = lockAccount(userId);
        BigDecimal delta = balance.subtract(account.getBalance());
        account.changeBalanceTo(balance);
        if (delta.signum() != 0) {
            BankTransactionType type = (delta.signum() > 0) ? BankTransactionType.ADJUST_UP
                    : BankTransactionType.ADJUST_DOWN;
            record(account, type, delta.abs(), null, available(account));
        }
        return toResponse(account);
    }

    @Override
    @Transactional(readOnly = true)
    public List<UUID> expiredHoldTrips(Instant now) {
        return this.holdRepository.findExpiredHeldTripIds(now, PageRequest.of(0, EXPIRY_BATCH));
    }

    /**
     * Gọi khi đã giữ khoá tài khoản: đọc khoản khoá lúc này để thấy trạng thái mới nhất.
     */
    private boolean releaseLocked(BankAccount account, UUID tripId) {
        Optional<FundHold> found = this.holdRepository.findByTripId(tripId);
        if (found.isEmpty() || found.get().getStatus() != HoldStatus.HELD) {
            return false;
        }
        FundHold hold = found.get();
        BigDecimal availableAfter = available(account).add(hold.getAmount());
        hold.release();
        this.holdRepository.save(hold);
        record(account, BankTransactionType.RELEASE, hold.getAmount(), tripId, availableAfter);
        log.info("Đã mở khoá {} của chuyến", hold.getAmount());
        return true;
    }

    private void recordClosed(UUID tripId, String reason) {
        if (this.closedTripRepository.existsById(tripId)) {
            return;
        }
        String value = (reason == null || reason.isBlank()) ? "closed" : reason;
        this.closedTripRepository
            .save(new ClosedTrip(tripId, value.substring(0, Math.min(value.length(), MAX_REASON_LENGTH))));
    }

    private BankAccount lockAccount(UUID userId) {
        this.accountRepository.insertIfAbsent(userId, this.initialBalance);
        return this.accountRepository.findForUpdate(userId)
            .orElseThrow(() -> new IllegalStateException("Không tạo được tài khoản ngân hàng ảo"));
    }

    private BigDecimal available(BankAccount account) {
        return account.getBalance().subtract(this.holdRepository.sumHeldByUserId(account.getUserId()));
    }

    private void record(BankAccount account, BankTransactionType type, BigDecimal amount, UUID tripId,
            BigDecimal availableAfter) {
        this.transactionRepository
            .save(new BankTransaction(account.getUserId(), type, amount, tripId, account.getBalance(), availableAfter));
    }

    private BankAccountResponse toResponse(BankAccount account) {
        BigDecimal held = this.holdRepository.sumHeldByUserId(account.getUserId());
        return new BankAccountResponse(account.getUserId(), account.getBalance(), held,
                account.getBalance().subtract(held));
    }

}
