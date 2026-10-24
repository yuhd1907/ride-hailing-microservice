package com.ridehail.driverservice.config;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.SimpleTransactionStatus;

import com.ridehail.driverservice.entity.Driver;
import com.ridehail.driverservice.entity.DriverStatus;
import com.ridehail.driverservice.mapper.DriverMapper;
import com.ridehail.driverservice.repository.DriverLocationRepository;
import com.ridehail.driverservice.repository.DriverRepository;
import com.ridehail.driverservice.service.DriverService;
import com.ridehail.driverservice.service.impl.DriverLocationRedisServiceImpl;
import com.ridehail.driverservice.service.impl.DriverServiceImpl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ServiceWiringTest {

    @Test
    void driverServiceResolvesItsMapperRedisAndInstanceIdAndKeepsTransactions() {
        DriverRepository repository = mock(DriverRepository.class);
        PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any(TransactionDefinition.class))).thenReturn(new SimpleTransactionStatus());
        Driver driver = new Driver();
        driver.setId(UUID.fromString("ab11f6b5-4dc9-47cc-bd2a-056f4c9eb53f"));
        driver.setStatus(DriverStatus.AVAILABLE);
        when(repository.findById(driver.getId())).thenReturn(Optional.of(driver));

        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.setEnvironment(
                    new MockEnvironment().withProperty("eureka.instance.instance-id", "driver-wiring-test"));
            context.registerBean(DriverRepository.class, () -> repository);
            context.registerBean(DriverLocationRepository.class, () -> mock(DriverLocationRepository.class));
            context.registerBean(StringRedisTemplate.class, () -> mock(StringRedisTemplate.class));
            context.registerBean(PlatformTransactionManager.class, () -> transactions);
            context.register(Transactions.class, DriverServiceImpl.class, DriverLocationRedisServiceImpl.class,
                    DriverMapper.class);
            context.refresh();

            DriverService service = context.getBean(DriverService.class);
            assertTrue(AopUtils.isAopProxy(service));
            assertEquals("driver-wiring-test", service.getInstanceId());
            assertEquals("AVAILABLE", service.getDriverById(driver.getId()).getStatus());
            verify(transactions).commit(any());
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    static class Transactions {

    }

}
