package com.ridehail.paymentservice.service.impl;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.ridehail.paymentservice.dto.response.BankAccountResponse;
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
import com.ridehail.paymentservice.service.CaptureOutcome;
import com.ridehail.paymentservice.service.HoldOutcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
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
import static org.mockito.Mockito.inOrder;
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

    @Mock
    private ClosedTripRepository closedTrips;

    private BankServiceImpl service;

    @BeforeEach
    void setUp() {
        this.service = new BankServiceImpl(this.accounts, this.holds, this.transactions, this.closedTrips, INITIAL,
                Duration.ofHours(2));
    }

    private BankAccount lockedAccount(String balance, String held) {
        BankAccount account = new BankAccount(USER, new BigDecimal(balance));
        when(this.accounts.findForUpdate(USER)).thenReturn(Optional.of(account));
        when(this.holds.sumHeldByUserId(USER)).thenReturn(new BigDecimal(held));
        return account;
    }

    private BankAccount lockOnly(String balance) {
        BankAccount account = new BankAccount(USER, new BigDecimal(balance));
        when(this.accounts.findForUpdate(USER)).thenReturn(Optional.of(account));
        return account;
    }

    private FundHold heldHold(String amount) {
        return new FundHold(TRIP, USER, new BigDecimal(amount), Instant.now().plusSeconds(60));
    }

    private BankTransaction savedTransaction() {
        ArgumentCaptor<BankTransaction> captor = ArgumentCaptor.forClass(BankTransaction.class);
        verify(this.transactions).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void holdCreatesAccountWithInitialBalanceAndHoldsFare() {
        lockedAccount("500000", "0");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());

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
    void holdLooksForExistingHoldOnlyAfterLockingAccount() {
        lockedAccount("500000", "0");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());

        this.service.hold(TRIP, USER, new BigDecimal("125000"));

        // Hai bản trip.requested của cùng chuyến xử lý đồng thời: bản sau phải thấy khoản
        // khoá
        // của bản trước (đọc sau khi chờ khoá tài khoản), không được báo nhầm là thiếu
        // tiền.
        InOrder order = inOrder(this.accounts, this.holds, this.closedTrips);
        order.verify(this.accounts).findForUpdate(USER);
        order.verify(this.holds).findByTripId(TRIP);
        order.verify(this.closedTrips).existsById(TRIP);
    }

    @Test
    void holdRejectsWhenAvailableBelowAmount() {
        lockedAccount("30000", "0");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());

        HoldOutcome outcome = this.service.hold(TRIP, USER, new BigDecimal("36000"));

        assertEquals(HoldOutcome.Decision.INSUFFICIENT_FUNDS, outcome.decision());
        assertNull(outcome.hold());
        verify(this.holds, never()).save(any());
        verify(this.transactions, never()).save(any());
        // Lần giao lại sau (eventId mới) thấy chuyến đã đóng, không khoá lại hay phát
        // thêm event
        ArgumentCaptor<ClosedTrip> closed = ArgumentCaptor.forClass(ClosedTrip.class);
        verify(this.closedTrips).save(closed.capture());
        assertEquals("INSUFFICIENT_FUNDS", closed.getValue().getReason());
    }

    @Test
    void holdCountsExistingHeldMoney() {
        lockedAccount("100000", "80000");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());

        assertEquals(HoldOutcome.Decision.INSUFFICIENT_FUNDS,
                this.service.hold(TRIP, USER, new BigDecimal("30000")).decision());
    }

    @Test
    void secondHoldForSameTripIsAlreadyHeld() {
        FundHold existing = heldHold("125000");
        lockOnly("500000");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.of(existing));

        HoldOutcome outcome = this.service.hold(TRIP, USER, new BigDecimal("125000"));

        assertEquals(HoldOutcome.Decision.ALREADY_HELD, outcome.decision());
        assertSame(existing, outcome.hold());
        verify(this.holds, never()).save(any());
    }

    @Test
    void holdReturnsTripClosedWhenTripWasClosedBeforeLock() {
        lockOnly("500000");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());
        when(this.closedTrips.existsById(TRIP)).thenReturn(true);

        HoldOutcome outcome = this.service.hold(TRIP, USER, new BigDecimal("125000"));

        assertEquals(HoldOutcome.Decision.TRIP_CLOSED, outcome.decision());
        verify(this.holds, never()).save(any());
    }

    @Test
    void closeTripLocksRiderBeforeReleasingOrRecording() {
        lockOnly("500000");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.empty());

        assertFalse(this.service.closeTrip(TRIP, USER, "trip.cancelled"));

        InOrder order = inOrder(this.accounts, this.holds, this.closedTrips);
        order.verify(this.accounts).findForUpdate(USER);
        order.verify(this.holds).findByTripId(TRIP);
        ArgumentCaptor<ClosedTrip> closed = ArgumentCaptor.forClass(ClosedTrip.class);
        order.verify(this.closedTrips).save(closed.capture());
        assertEquals("trip.cancelled", closed.getValue().getReason());
    }

    @Test
    void closeTripReleasesHeldMoney() {
        FundHold held = heldHold("125000");
        lockedAccount("500000", "125000");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.of(held));

        assertTrue(this.service.closeTrip(TRIP, USER, "NO_AVAILABLE_DRIVERS"));

        assertEquals(HoldStatus.RELEASED, held.getStatus());
        assertEquals(BankTransactionType.RELEASE, savedTransaction().getType());
        verify(this.closedTrips, never()).save(any());
    }

    @Test
    void releaseReadsHoldOnlyAfterLockingAccount() {
        FundHold held = heldHold("125000");
        when(this.holds.findUserIdByTripId(TRIP)).thenReturn(Optional.of(USER));
        lockedAccount("500000", "125000");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.of(held));

        assertTrue(this.service.release(TRIP));

        // Đọc trạng thái khoản khoá sau khi đã khoá tài khoản, để không ghi đè một khoản
        // vừa bị
        // trừ tiền (CAPTURED) bằng bản đọc cũ.
        InOrder order = inOrder(this.accounts, this.holds);
        order.verify(this.holds).findUserIdByTripId(TRIP);
        order.verify(this.accounts).findForUpdate(USER);
        order.verify(this.holds).findByTripId(TRIP);
        assertEquals(HoldStatus.RELEASED, held.getStatus());
        assertEquals(BankTransactionType.RELEASE, savedTransaction().getType());
    }

    @Test
    void releaseSkipsHoldThatIsNoLongerHeld() {
        FundHold captured = heldHold("125000");
        captured.capture();
        when(this.holds.findUserIdByTripId(TRIP)).thenReturn(Optional.of(USER));
        lockOnly("500000");
        when(this.holds.findByTripId(TRIP)).thenReturn(Optional.of(captured));

        assertFalse(this.service.release(TRIP));
        assertEquals(HoldStatus.CAPTURED, captured.getStatus());
        verify(this.transactions, never()).save(any());

        UUID other = UUID.randomUUID();
        when(this.holds.findUserIdByTripId(other)).thenReturn(Optional.empty());
        assertFalse(this.service.release(other));
    }

    @Test
    void captureDebitsHeldAmount() {
        FundHold held = heldHold("125000");
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
    void bankTripCreditsDriverFareMinusCommission() {
        BankAccount account = lockedAccount("100000", "0");

        this.service.settleDriver(TRIP, USER, new BigDecimal("117000"), false);

        // 20% chiết khấu: 117.000 - 23.400 = 93.600
        assertEquals(0, new BigDecimal("193600").compareTo(account.getBalance()));
        BankTransaction tx = savedTransaction();
        assertEquals(BankTransactionType.EARNING, tx.getType());
        assertEquals(0, new BigDecimal("93600").compareTo(tx.getAmount()));
    }

    @Test
    void cashTripDebitsCommissionEvenBelowZero() {
        BankAccount account = lockedAccount("10000", "0");

        this.service.settleDriver(TRIP, USER, new BigDecimal("117000"), true);

        assertEquals(0, new BigDecimal("-13400").compareTo(account.getBalance()));
        assertEquals(BankTransactionType.COMMISSION, savedTransaction().getType());
    }

    @Test
    void settlementIsRecordedOncePerTrip() {
        BankAccount account = lockOnly("100000");
        when(this.transactions.existsByTripIdAndUserIdAndType(TRIP, USER, BankTransactionType.EARNING)).thenReturn(true);

        this.service.settleDriver(TRIP, USER, new BigDecimal("117000"), false);

        assertEquals(0, new BigDecimal("100000").compareTo(account.getBalance()));
        verify(this.transactions, never()).save(any());
    }

    @Test
    void tipMovesMoneyFromRiderToDriverOncePerTrip() {
        UUID driverId = UUID.fromString("6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b");
        BankAccount rider = lockedAccount("100000", "20000");
        BankAccount driver = new BankAccount(driverId, new BigDecimal("50000"));
        when(this.accounts.findForUpdate(driverId)).thenReturn(Optional.of(driver));
        when(this.holds.sumHeldByUserId(driverId)).thenReturn(BigDecimal.ZERO);

        this.service.tip(TRIP, USER, driverId, new BigDecimal("20000"));

        assertEquals(0, new BigDecimal("80000").compareTo(rider.getBalance()));
        assertEquals(0, new BigDecimal("70000").compareTo(driver.getBalance()));
        verify(this.transactions, org.mockito.Mockito.times(2)).save(any());

        when(this.transactions.existsByTripIdAndUserIdAndType(TRIP, USER, BankTransactionType.TIP_SENT)).thenReturn(true);
        assertThrows(com.ridehail.paymentservice.config.exception.ConflictException.class,
                () -> this.service.tip(TRIP, USER, driverId, new BigDecimal("20000")));
    }

    @Test
    void tipNeedsAvailableBalanceAndValidAmount() {
        UUID driverId = UUID.fromString("6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b");
        assertThrows(IllegalArgumentException.class, () -> this.service.tip(TRIP, USER, driverId, new BigDecimal("4999")));
        BankAccount rider = lockedAccount("30000", "20000");

        assertThrows(com.ridehail.paymentservice.config.exception.ConflictException.class,
                () -> this.service.tip(TRIP, USER, driverId, new BigDecimal("15000")));
        assertEquals(0, new BigDecimal("30000").compareTo(rider.getBalance()));
    }

    @Test
    void withdrawNeedsAvailableBalance() {
        BankAccount account = lockedAccount("300000", "0");
        assertThrows(IllegalArgumentException.class, () -> this.service.withdraw(USER, new BigDecimal("49999")));
        assertThrows(com.ridehail.paymentservice.config.exception.ConflictException.class,
                () -> this.service.withdraw(USER, new BigDecimal("300001")));

        this.service.withdraw(USER, new BigDecimal("200000"));

        assertEquals(0, new BigDecimal("100000").compareTo(account.getBalance()));
        assertEquals(BankTransactionType.WITHDRAW, savedTransaction().getType());
    }

    @Test
    void setBalanceRecordsAdjustment() {
        BankAccount account = lockedAccount("300000", "0");

        this.service.setBalance(USER, new BigDecimal("2000000"));

        assertEquals(0, new BigDecimal("2000000").compareTo(account.getBalance()));
        BankTransaction tx = savedTransaction();
        assertEquals(BankTransactionType.ADJUST_UP, tx.getType());
        assertEquals(0, new BigDecimal("1700000").compareTo(tx.getAmount()));
        assertThrows(IllegalArgumentException.class, () -> this.service.setBalance(USER, new BigDecimal("-1")));
        assertThrows(IllegalArgumentException.class,
                () -> this.service.setBalance(USER, new BigDecimal("1000000000.01")));
    }

    @Test
    void lowerBalanceIsRecordedAsAdjustDown() {
        lockedAccount("2000000", "0");

        this.service.setBalance(USER, new BigDecimal("500000"));

        BankTransaction tx = savedTransaction();
        assertEquals(BankTransactionType.ADJUST_DOWN, tx.getType());
        assertEquals(0, new BigDecimal("1500000").compareTo(tx.getAmount()));
    }

    @Test
    void accountReadsWithoutLockingOrCreating() {
        when(this.accounts.findById(USER)).thenReturn(Optional.empty());

        BankAccountResponse fresh = this.service.account(USER);

        assertEquals(0, INITIAL.compareTo(fresh.balance()));
        assertEquals(0, INITIAL.compareTo(fresh.available()));
        verify(this.accounts, never()).insertIfAbsent(any(), any());
        verify(this.accounts, never()).findForUpdate(any());

        when(this.accounts.findById(USER)).thenReturn(Optional.of(new BankAccount(USER, new BigDecimal("300000"))));
        when(this.holds.sumHeldByUserId(USER)).thenReturn(new BigDecimal("100000"));
        assertEquals(0, new BigDecimal("200000").compareTo(this.service.account(USER).available()));
    }

    @Test
    void newLedgerRowsAreInsertedWithoutMergeSelect() {
        // isNew() == true để save() chạy INSERT thẳng, không SELECT trước như merge()
        assertTrue(heldHold("1000").isNew());
        assertTrue(new BankTransaction(USER, BankTransactionType.TOPUP, BigDecimal.TEN, null, BigDecimal.TEN,
                BigDecimal.TEN)
            .isNew());
    }

    @Test
    void expiredHoldTripsReturnsTripIdsWithoutLoadingHolds() {
        UUID secondTrip = UUID.randomUUID();
        Instant now = Instant.now();
        when(this.holds.findExpiredHeldTripIds(eq(now), any())).thenReturn(List.of(TRIP, secondTrip));

        assertEquals(List.of(TRIP, secondTrip), this.service.expiredHoldTrips(now));
        verify(this.holds, never()).findByTripId(any());
    }

}
