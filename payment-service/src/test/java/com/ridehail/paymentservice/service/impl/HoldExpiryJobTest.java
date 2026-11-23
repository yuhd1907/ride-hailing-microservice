package com.ridehail.paymentservice.service.impl;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.ridehail.paymentservice.service.BankService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class HoldExpiryJobTest {

    @Mock
    private BankService bankService;

    @Test
    void expiryReleasesEachTripSeparatelyAndContinuesAfterFailure() {
        UUID first = UUID.randomUUID();
        UUID broken = UUID.randomUUID();
        UUID last = UUID.randomUUID();
        when(this.bankService.expiredHoldTrips(any(Instant.class))).thenReturn(List.of(first, broken, last));
        when(this.bankService.release(first)).thenReturn(true);
        when(this.bankService.release(broken)).thenThrow(new IllegalStateException("lỗi tạm thời"));
        when(this.bankService.release(last)).thenReturn(true);

        new HoldExpiryJob(this.bankService).expire();

        // Mỗi chuyến một transaction; khoản lỗi không chặn các khoản khác
        verify(this.bankService).release(first);
        verify(this.bankService).release(broken);
        verify(this.bankService).release(last);
    }

}
