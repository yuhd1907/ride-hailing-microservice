package com.ridehail.paymentservice.service.impl;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.entity.BankAccount;
import com.ridehail.paymentservice.entity.BankTransaction;
import com.ridehail.paymentservice.entity.BankTransactionType;
import com.ridehail.paymentservice.entity.FundHold;
import com.ridehail.paymentservice.entity.HoldStatus;
import com.ridehail.paymentservice.repository.BankAccountRepository;
import com.ridehail.paymentservice.repository.BankTransactionRepository;
import com.ridehail.paymentservice.repository.FundHoldRepository;
import com.ridehail.paymentservice.service.CaptureOutcome;
import com.ridehail.paymentservice.service.HoldOutcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BankServiceImplTest {

    private static final UUID USER = UUID.fromString("26a7f8fe-79a8-49ea-a46a-9529e5c3e381");

    private static final UUID TRIP = UUID.fromString("5b0e6f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b");

    private static final BigDecimal INITIAL = new BigDecimal("500000");

    @Mock
    private BankAccountRepository accounts;

    @Mock
    private FundHoldRepository holds;

    @Mock
    private BankTransactionRepository transactions;

    private BankServiceImpl service;

    @BeforeEach
    void setUp() {
        this.service = new BankServiceImpl(this.accounts, this.holds, this.transactions, INITIAL, Duration.ofHours(2));
    }

    private BankAccount lockedAccount(String balance, String held) {
        BankAccount account = new BankAccount(USER, new BigDecimal(balance));
        when(this.accounts.findForUpdate(USER)).thenReturn(Optional.of(account));
        when(this.holds.sumHeldByUserId(USER)).thenReturn(new BigDecimal(held));
        return account;
    }

    private BankTransaction savedTransaction() {
        ArgumentCaptor<BankTransaction> captor = ArgumentCaptor.forClass(BankTransaction.class);
        verify(this.transactions).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void holdCreatesAccountWithInitialBalanceAndHoldsFare() {
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());
        lockedAccount("500000", "0");

        HoldOutcome outcome = this.service.hold(TRIP, USER, new BigDecimal("125000"));

        verify(this.accounts).insertIfAbsent(USER, INITIAL);
        assertEquals(HoldOutcome.Decision.HELD, outcome.decision());
        ArgumentCaptor<FundHold> hold = ArgumentCaptor.forClass(FundHold.class);
        verify(this.holds).save(hold.capture());
        assertSame(hold.getValue(), outcome.hold());
        assertEquals(0, new BigDecimal("125000").compareTo(hold.getValue().getAmount()));
        assertEquals(HoldStatus.HELD, hold.getValue().getStatus());
        Duration ttl = Duration.between(Instant.now(), hold.getValue().getExpiresAt());
        assertTrue(ttl.compareTo(Duration.ofMinutes(119)) > 0 && ttl.compareTo(Duration.ofMinutes(121)) < 0);
        BankTransaction tx = savedTransaction();
        assertEquals(BankTransactionType.HOLD, tx.getType());
        assertEquals(0, new BigDecimal("375000").compareTo(tx.getAvailableAfter()));
    }

    @Test
    void holdRejectsWhenAvailableBelowAmount() {
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());
        lockedAccount("30000", "0");

        HoldOutcome outcome = this.service.hold(TRIP, USER, new BigDecimal("36000"));

        assertEquals(HoldOutcome.Decision.INSUFFICIENT_FUNDS, outcome.decision());
        assertNull(outcome.hold());
        verify(this.holds, never()).save(any());
        verify(this.transactions, never()).save(any());
    }

    @Test
    void holdCountsExistingHeldMoney() {
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());
        lockedAccount("100000", "80000");

        assertEquals(HoldOutcome.Decision.INSUFFICIENT_FUNDS,
                this.service.hold(TRIP, USER, new BigDecimal("30000")).decision());
    }

    @Test
    void secondHoldForSameTripIsAlreadyHeld() {
        FundHold existing = new FundHold(TRIP, USER, new BigDecimal("125000"), Instant.now().plusSeconds(60));
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.of(existing));

        HoldOutcome outcome = this.service.hold(TRIP, USER, new BigDecimal("125000"));

        assertEquals(HoldOutcome.Decision.ALREADY_HELD, outcome.decision());
        assertSame(existing, outcome.hold());
        verify(this.accounts, never()).findForUpdate(any());
    }

    @Test
    void releaseOnlyReleasesHeld() {
        FundHold held = new FundHold(TRIP, USER, new BigDecimal("125000"), Instant.now().plusSeconds(60));
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.of(held));
        lockedAccount("500000", "125000");

        assertTrue(this.service.release(TRIP));
        assertEquals(HoldStatus.RELEASED, held.getStatus());
        assertEquals(BankTransactionType.RELEASE, savedTransaction().getType());

        assertFalse(this.service.release(TRIP), "khoản đã RELEASED không mở lần hai");
        UUID other = UUID.randomUUID();
        when(this.holds.findByTripId(other)).thenReturn(Optional.empty());
        assertFalse(this.service.release(other));
    }

    @Test
    void captureDebitsHeldAmount() {
        FundHold held = new FundHold(TRIP, USER, new BigDecimal("125000"), Instant.now().plusSeconds(60));
        BankAccount account = lockedAccount("500000", "125000");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.of(held));

        assertEquals(CaptureOutcome.CAPTURED, this.service.capture(TRIP, USER, new BigDecimal("125000")));

        assertEquals(0, new BigDecimal("375000").compareTo(account.getBalance()));
        assertEquals(HoldStatus.CAPTURED, held.getStatus());
        assertEquals(BankTransactionType.CAPTURE, savedTransaction().getType());
    }

    @Test
    void captureWithoutHoldDebitsDirectlyOrFails() {
        BankAccount rich = lockedAccount("500000", "0");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());
        assertEquals(CaptureOutcome.CAPTURED, this.service.capture(TRIP, USER, new BigDecimal("125000")));
        assertEquals(0, new BigDecimal("375000").compareTo(rich.getBalance()));

        BankAccount poor = lockedAccount("30000", "0");
        assertEquals(CaptureOutcome.INSUFFICIENT_FUNDS, this.service.capture(TRIP, USER, new BigDecimal("125000")));
        assertEquals(0, new BigDecimal("30000").compareTo(poor.getBalance()));
    }

    @Test
    void topUpRejectsOutOfRangeAmounts() {
        assertThrows(IllegalArgumentException.class, () -> this.service.topUp(USER, new BigDecimal("999")));
        assertThrows(IllegalArgumentException.class, () -> this.service.topUp(USER, new BigDecimal("5000001")));

        BankAccount account = lockedAccount("500000", "0");
        this.service.topUp(USER, new BigDecimal("100000"));

        assertEquals(0, new BigDecimal("600000").compareTo(account.getBalance()));
        assertEquals(BankTransactionType.TOPUP, savedTransaction().getType());
    }

    @Test
    void setBalanceRecordsAdjustment() {
        BankAccount account = lockedAccount("300000", "0");

        this.service.setBalance(USER, new BigDecimal("2000000"));

        assertEquals(0, new BigDecimal("2000000").compareTo(account.getBalance()));
        BankTransaction tx = savedTransaction();
        assertEquals(BankTransactionType.ADJUST, tx.getType());
        assertEquals(0, new BigDecimal("1700000").compareTo(tx.getAmount()));
        assertThrows(IllegalArgumentException.class, () -> this.service.setBalance(USER, new BigDecimal("-1")));
    }

    @Test
    void expireHoldsReleasesOverdueHolds() {
        UUID secondTrip = UUID.randomUUID();
        FundHold first = new FundHold(TRIP, USER, new BigDecimal("10000"), Instant.now().minusSeconds(60));
        FundHold second = new FundHold(secondTrip, USER, new BigDecimal("20000"), Instant.now().minusSeconds(60));
        when(this.holds.findByStatusAndExpiresAtBefore(eq(HoldStatus.HELD), any(Instant.class), any()))
            .thenReturn(List.of(first, second));
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.of(first));
        when(this.holds.findByTripId(secondTrip)).thenReturn(Optional.of(second));
        lockedAccount("500000", "30000");

        assertEquals(2, this.service.expireHolds(Instant.now()));
        assertEquals(HoldStatus.RELEASED, first.getStatus());
        assertEquals(HoldStatus.RELEASED, second.getStatus());
    }

}
