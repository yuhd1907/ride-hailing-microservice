package com.ridehail.driverservice.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.connection.Connection;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMqConfig {

    private static final Logger log = LoggerFactory.getLogger(RabbitMqConfig.class);

    @Bean
    @ConditionalOnProperty(name = "driver.rabbitmq.verify-on-startup", havingValue = "true", matchIfMissing = true)
    ApplicationRunner verifyRabbitMqConnection(ConnectionFactory connectionFactory) {
        return args -> {
            try (Connection connection = connectionFactory.createConnection()) {
                if (!connection.isOpen()) {
                    throw new IllegalStateException("RabbitMQ connection is not open");
                }
                log.info("Driver service connected to RabbitMQ");
            }
        };
    }

}
