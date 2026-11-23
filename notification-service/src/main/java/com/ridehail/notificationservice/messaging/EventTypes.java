package com.ridehail.notificationservice.messaging;

import java.util.List;

/**
 * Tên event, đồng thời là routing key trên exchange rideflow.events
 */
public final class EventTypes {

    public static final String DRIVER_ASSIGNED = "matching.driver_assigned";

    public static final String PAYMENT_SUCCEEDED = "payment.succeeded";

    public static final String PAYMENT_FAILED = "payment.failed";

    public static final String TRIP_COMPENSATED = "trip.compensated";

    public static final String TRIP_FAILED = "trip.failed";

    public static final List<String> SUBSCRIBED = List.of(DRIVER_ASSIGNED, PAYMENT_SUCCEEDED, PAYMENT_FAILED,
            TRIP_COMPENSATED, TRIP_FAILED);

    private EventTypes() {
    }

}
