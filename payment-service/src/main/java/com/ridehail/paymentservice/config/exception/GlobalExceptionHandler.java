package com.ridehail.paymentservice.config.exception;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.amqp.AmqpException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    // Giữ nguyên 400/404/405/415 của framework thay vì biến lỗi phía client thành 500
    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        HttpStatus resolved = HttpStatus.resolve(status.value());
        String message = (status.value() == 400) ? "Dữ liệu đầu vào không hợp lệ"
                : (resolved != null) ? resolved.getReasonPhrase() : "HTTP error";
        return new ResponseEntity<>(error(status, message), headers, status);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, Object>> notFound(ResourceNotFoundException ex) {
        return response(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<Map<String, Object>> unauthorized(UnauthorizedException ex) {
        return response(HttpStatus.UNAUTHORIZED, ex.getMessage());
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<Map<String, Object>> forbidden(ForbiddenException ex) {
        return response(HttpStatus.FORBIDDEN, ex.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> badRequest(IllegalArgumentException ex) {
        return response(HttpStatus.BAD_REQUEST, ex.getMessage());
    }

    @ExceptionHandler({ DataAccessResourceFailureException.class, CannotCreateTransactionException.class })
    public ResponseEntity<Map<String, Object>> storageUnavailable(Exception ex) {
        log.warn("Storage service unavailable", ex);
        return response(HttpStatus.SERVICE_UNAVAILABLE, "Không thể kết nối dịch vụ lưu trữ");
    }

    @ExceptionHandler(AmqpException.class)
    public ResponseEntity<Map<String, Object>> brokerUnavailable(AmqpException ex) {
        log.warn("Message broker unavailable: {}", ex.getMessage());
        return response(HttpStatus.SERVICE_UNAVAILABLE, "Không thể kết nối RabbitMQ");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> unexpected(Exception ex) {
        log.error("Unexpected error", ex);
        return response(HttpStatus.INTERNAL_SERVER_ERROR, "Lỗi hệ thống nội bộ");
    }

    private ResponseEntity<Map<String, Object>> response(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(error(status, message));
    }

    private Map<String, Object> error(HttpStatusCode status, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status", status.value());
        HttpStatus resolved = HttpStatus.resolve(status.value());
        body.put("error", (resolved != null) ? resolved.getReasonPhrase() : "HTTP error");
        body.put("message", message);
        body.put("correlationId", MDC.get("correlationId"));
        return body;
    }

}
