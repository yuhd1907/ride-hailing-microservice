package com.ridehail.paymentservice.service.impl;

import java.time.Instant;

import com.ridehail.paymentservice.service.BankService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Lưới an toàn: mở các khoản khoá quá hạn (chuyến không bao giờ hoàn thành hoặc event hủy
 * bị mất) để tiền của khách không bị khoá mãi.
 */
@Component
public class HoldExpiryJob {

    private static final Logger log = LoggerFactory.getLogger(HoldExpiryJob.class);

    private final BankService bankService;

    public HoldExpiryJob(BankService bankService) {
        this.bankService = bankService;
    }

    @Scheduled(fixedDelayString = "${payment.bank.expiry-check-interval-ms:60000}",
            initialDelayString = "${payment.bank.expiry-check-interval-ms:60000}")
    public void expire() {
        try {
            int released = this.bankService.expireHolds(Instant.now());
            if (released > 0) {
                log.info("Đã mở {} khoản khoá quá hạn", released);
            }
        }
        catch (RuntimeException ex) {
            log.warn("Không mở được khoản khoá quá hạn: {}", ex.getMessage());
        }
    }

}
