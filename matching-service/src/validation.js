'use strict';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const money = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 9999999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001;
class InvalidEvent extends Error {}
function validate(event, type) {
  if (!event || !uuid(event.eventId) || !uuid(event.correlationId) || event.eventType !== type || !utc(event.occurredAt) || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new InvalidEvent('Invalid event envelope');
  const p = event.payload;
  if (!uuid(p.tripId) || !uuid(p.riderId)) throw new InvalidEvent('Invalid tripId/riderId');
  if (type === 'payment.authorized' || type === 'payment.authorization_failed') {
    if (!money(p.amount)) throw new InvalidEvent('Invalid authorization amount');
    if (type === 'payment.authorized' && (!['BANK', 'CASH'].includes(p.paymentMethod) || (p.holdId != null && !uuid(p.holdId)) || !utc(p.authorizedAt))) throw new InvalidEvent('Invalid authorization');
    if (type === 'payment.authorization_failed' && (p.reason !== 'INSUFFICIENT_FUNDS' || !utc(p.failedAt))) throw new InvalidEvent('Invalid authorization failure');
  } else if (type.startsWith('payment.')) {
    if (!uuid(p.paymentId) || (p.driverId != null && !uuid(p.driverId)) || !money(p.amount)) throw new InvalidEvent('Invalid payment payload');
    if (type === 'payment.succeeded' && !utc(p.paidAt)) throw new InvalidEvent('Invalid paidAt');
    if (type === 'payment.failed' && (!utc(p.failedAt) || !['INSUFFICIENT_FUNDS', 'PAYMENT_DECLINED', 'INTERNAL_ERROR'].includes(p.reason))) throw new InvalidEvent('Invalid failure payload');
  } else if (type === 'trip.requested' || type === 'trip.driver_rejected' || type === 'trip.matching_requested') {
    if (!p.pickup || !Number.isFinite(p.pickup.lat) || Math.abs(p.pickup.lat) > 90 || !Number.isFinite(p.pickup.lng) || Math.abs(p.pickup.lng) > 180) throw new InvalidEvent('Invalid pickup');
    if (p.vehicleType != null && !['MOTORCYCLE', 'CAR_4_SEAT', 'CAR_7_SEAT'].includes(p.vehicleType)) throw new InvalidEvent('Invalid vehicleType');
    if (type === 'trip.driver_rejected' && (!uuid(p.driverId) || !utc(p.rejectedAt))) throw new InvalidEvent('Invalid rejection');
  } else if (type === 'matching.driver_assigned' && (!uuid(p.driverId) || !utc(p.assignedAt) || (p.reservationId != null && !uuid(p.reservationId)))) throw new InvalidEvent('Invalid assignment');
  else if (type === 'matching.failed' || type === 'trip.failed') {
    const reasons = type === 'trip.failed' ? ['NO_AVAILABLE_DRIVERS', 'INSUFFICIENT_FUNDS'] : ['NO_AVAILABLE_DRIVERS'];
    if (!reasons.includes(p.reason) || !utc(p.failedAt)) throw new InvalidEvent('Invalid matching failure');
  } else if (type === 'trip.cancelled' && ((p.driverId != null && !uuid(p.driverId)) || !utc(p.cancelledAt))) throw new InvalidEvent('Invalid cancellation');
  return event;
}
module.exports = { uuid, utc, money, validate, InvalidEvent };
