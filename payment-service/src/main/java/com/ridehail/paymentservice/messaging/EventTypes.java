package com.ridehail.paymentservice.messaging;

import java.util.List;

/**
 * Tên event, đồng thời là routing key trên exchange rideflow.events
 */
public final class EventTypes {

    public static final String TRIP_COMPLETED = "trip.completed";

    public static final String TRIP_REQUESTED = "trip.requested";

    public static final String TRIP_CANCELLED = "trip.cancelled";

    public static final String TRIP_FAILED = "trip.failed";

    public static final String PAYMENT_AUTHORIZED = "payment.authorized";

    public static final String PAYMENT_AUTHORIZATION_FAILED = "payment.authorization_failed";

    /**
     * Event mà Payment Service nghe, mỗi loại một queue payment-service.<eventType>.
     */
    public static final List<String> SUBSCRIBED = List.of(TRIP_COMPLETED, TRIP_REQUESTED, TRIP_CANCELLED, TRIP_FAILED);

    public static final String PAYMENT_SUCCEEDED = "payment.succeeded";

    public static final String PAYMENT_FAILED = "payment.failed";

    private EventTypes() {
    }

}
