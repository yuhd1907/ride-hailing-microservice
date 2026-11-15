package com.ridehail.paymentservice.messaging;

/**
 * Tên event, đồng thời là routing key trên exchange rideflow.events
 */
public final class EventTypes {

    public static final String TRIP_COMPLETED = "trip.completed";

    public static final String PAYMENT_SUCCEEDED = "payment.succeeded";

    public static final String PAYMENT_FAILED = "payment.failed";

    private EventTypes() {
    }

}
