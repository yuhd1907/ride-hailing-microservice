package com.ridehail.userservice.config.exception;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        Map<String, Object> body = error(status, "Dữ liệu đầu vào không hợp lệ");
        Map<String, String> fields = new LinkedHashMap<>();
        ex.getBindingResult()
            .getFieldErrors()
            .forEach(field -> fields.put(field.getField(), field.getDefaultMessage()));
        body.put("errors", fields);
        return new ResponseEntity<>(body, headers, status);
    }

    // Preserve the framework's 400/404/405/415 instead of turning client errors into 500.
    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        HttpStatus resolved = HttpStatus.resolve(status.value());
        String message = status.value() == 400 ? "Dữ liệu đầu vào không hợp lệ"
                : resolved == null ? "HTTP error" : resolved.getReasonPhrase();
        return new ResponseEntity<>(error(status, message), headers, status);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, Object>> notFound(ResourceNotFoundException ex) {
        return response(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<Map<String, Object>> accountConflict(ConflictException ex) {
        return response(HttpStatus.CONFLICT, ex.getMessage());
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<Map<String, Object>> unauthorized(UnauthorizedException ex) {
        return response(HttpStatus.UNAUTHORIZED, ex.getMessage());
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<Map<String, Object>> forbidden(ForbiddenException ex) {
        return response(HttpStatus.FORBIDDEN, ex.getMessage());
    }

    @ExceptionHandler(io.jsonwebtoken.JwtException.class)
    public ResponseEntity<Map<String, Object>> invalidToken(io.jsonwebtoken.JwtException ex) {
        return response(HttpStatus.UNAUTHORIZED, "Token không hợp lệ hoặc đã hết hạn");
    }

    @ExceptionHandler({ DataIntegrityViolationException.class, ObjectOptimisticLockingFailureException.class })
    public ResponseEntity<Map<String, Object>> conflict(Exception ex) {
        return response(HttpStatus.CONFLICT, "Dữ liệu đã tồn tại hoặc vừa được cập nhật bởi yêu cầu khác");
    }

    @ExceptionHandler({ DataAccessResourceFailureException.class, CannotCreateTransactionException.class })
    public ResponseEntity<Map<String, Object>> unavailable(Exception ex) {
        log.warn("Storage service unavailable", ex);
        return response(HttpStatus.SERVICE_UNAVAILABLE, "Không thể kết nối dịch vụ lưu trữ");
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
        body.put("error", resolved == null ? "HTTP error" : resolved.getReasonPhrase());
        body.put("message", message);
        body.put("correlationId", MDC.get("correlationId"));
        return body;
    }

}
