package com.ridehail.paymentservice.service.impl;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.dto.response.BankAccountResponse;
import com.ridehail.paymentservice.dto.response.BankTransactionResponse;
import com.ridehail.paymentservice.entity.BankAccount;
import com.ridehail.paymentservice.entity.BankTransaction;
import com.ridehail.paymentservice.entity.BankTransactionType;
import com.ridehail.paymentservice.entity.FundHold;
import com.ridehail.paymentservice.entity.HoldStatus;
import com.ridehail.paymentservice.repository.BankAccountRepository;
import com.ridehail.paymentservice.repository.BankTransactionRepository;
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

@Service
public class BankServiceImpl implements BankService {

    private static final Logger log = LoggerFactory.getLogger(BankServiceImpl.class);

    static final BigDecimal MIN_TOP_UP = new BigDecimal("1000");

    static final BigDecimal MAX_TOP_UP = new BigDecimal("5000000");

    private static final int EXPIRY_BATCH = 100;

    private static final int MAX_LIMIT = 100;

    private final BankAccountRepository accountRepository;

    private final FundHoldRepository holdRepository;

    private final BankTransactionRepository transactionRepository;

    private final BigDecimal initialBalance;

    private final Duration holdTtl;

    public BankServiceImpl(BankAccountRepository accountRepository, FundHoldRepository holdRepository,
            BankTransactionRepository transactionRepository,
            @Value("${payment.bank.initial-balance:500000}") BigDecimal initialBalance,
            @Value("${payment.bank.hold-ttl:PT2H}") Duration holdTtl) {
        this.accountRepository = accountRepository;
        this.holdRepository = holdRepository;
        this.transactionRepository = transactionRepository;
        this.initialBalance = initialBalance;
        this.holdTtl = holdTtl;
    }

    @Override
    @Transactional
    public HoldOutcome hold(UUID tripId, UUID userId, BigDecimal amount) {
        Optional<FundHold> existing = this.holdRepository.findByTripId(tripId);
        if (existing.isPresent()) {
            return new HoldOutcome(HoldOutcome.Decision.ALREADY_HELD, existing.get());
        }
        BankAccount account = lockAccount(userId);
        BigDecimal available = available(account);
        if (available.compareTo(amount) < 0) {
            log.info("Không đủ số dư để khoá {}: khả dụng {}", amount, available);
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
        Optional<FundHold> found = this.holdRepository.findByTripId(tripId);
        if (found.isEmpty() || found.get().getStatus() != HoldStatus.HELD) {
            return false;
        }
        FundHold hold = found.get();
        BankAccount account = lockAccount(hold.getUserId());
        BigDecimal availableAfter = available(account).add(hold.getAmount());
        hold.release();
        this.holdRepository.save(hold);
        record(account, BankTransactionType.RELEASE, hold.getAmount(), tripId, availableAfter);
        log.info("Đã mở khoá {} của chuyến", hold.getAmount());
        return true;
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
    @Transactional
    public BankAccountResponse account(UUID userId) {
        return toResponse(lockAccount(userId));
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
        if (balance == null || balance.signum() < 0) {
            throw new IllegalArgumentException("Số dư phải >= 0");
        }
        BankAccount account = lockAccount(userId);
        BigDecimal delta = balance.subtract(account.getBalance());
        account.changeBalanceTo(balance);
        if (delta.signum() != 0) {
            record(account, BankTransactionType.ADJUST, delta.abs(), null, available(account));
        }
        return toResponse(account);
    }

    @Override
    @Transactional
    public int expireHolds(Instant now) {
        List<FundHold> overdue = this.holdRepository.findByStatusAndExpiresAtBefore(HoldStatus.HELD, now,
                PageRequest.of(0, EXPIRY_BATCH));
        int released = 0;
        for (FundHold hold : overdue) {
            if (release(hold.getTripId())) {
                released++;
            }
        }
        return released;
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
