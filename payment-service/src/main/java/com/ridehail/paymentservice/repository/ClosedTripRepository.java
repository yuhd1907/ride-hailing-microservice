package com.ridehail.paymentservice.repository;

import java.util.UUID;

import com.ridehail.paymentservice.entity.ClosedTrip;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ClosedTripRepository extends JpaRepository<ClosedTrip, UUID> {

}
