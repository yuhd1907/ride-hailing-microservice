package com.ridehail.paymentservice.entity;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;

/**
 * Chuyến đã hủy hoặc thất bại khi chưa có khoản khoá tiền. Nếu trip.requested tới sau
 * (message đến không theo thứ tự) thì Payment không khoá tiền cho chuyến đó nữa.
 */
@Entity
@Table(name = "closed_trips")
public class ClosedTrip {

    @Id
    @Column(name = "trip_id", nullable = false, updatable = false)
    private UUID tripId;

    @Column(name = "reason", length = 40, nullable = false, updatable = false)
    private String reason;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    protected ClosedTrip() {
    }

    public ClosedTrip(UUID tripId, String reason) {
        this.tripId = tripId;
        this.reason = reason;
    }

    public UUID getTripId() {
        return this.tripId;
    }

    public String getReason() {
        return this.reason;
    }

    public Instant getCreatedAt() {
        return this.createdAt;
    }

}
