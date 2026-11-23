export type Role = 'ROLE_PASSENGER' | 'ROLE_DRIVER';

export interface Session {
  id: string;
  email: string;
  userId: string;
  roles: string[];
  token: string;
  expiresAt: number;
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  durationMs: number;
  correlationId: string | null;
  instance: string | null;
}

export interface RequestLogEntry {
  id: string;
  at: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  correlationId: string | null;
  instance: string | null;
  actor: string | null;
  requestBody?: unknown;
  responseBody?: unknown;
}

export interface Point {
  lat: number;
  lng: number;
  /** Địa chỉ hiển thị, lưu cùng tọa độ trong trip_db. */
  address?: string;
}

export type TripStatus =
  | 'REQUESTED'
  | 'MATCHING'
  | 'AWAITING_DRIVER'
  | 'IN_PROGRESS'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface Trip {
  tripId: string;
  passengerId: string;
  driverId: string | null;
  rejectedDriverIds?: string[];
  pickup: Point;
  destination: Point;
  estimatedDistance: string | number;
  fare: string | number;
  status: TripStatus;
  vehicleType?: VehicleType;
  paymentId: string | null;
  sagaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VehicleType = 'MOTORCYCLE' | 'CAR_4_SEAT' | 'CAR_7_SEAT';

export interface FareEstimate {
  estimatedDistance: number;
  fareAmount: number;
  currency: string;
  pricingVersion: string;
  vehicleType?: VehicleType;
  options?: FareOption[];
}

export interface FareOption extends FareEstimate {
  vehicleType: VehicleType;
  displayName: string;
  seats: number;
}

/** Bảng giá theo loại xe (bảng fare_rates trong trip_db). */
export interface FareRate {
  vehicleType: VehicleType;
  displayName: string;
  seats: number;
  baseFare: number;
  perKm: number;
}

export type DriverStatus = 'OFFLINE' | 'AVAILABLE' | 'RESERVED' | 'ON_TRIP';

export interface Driver {
  id: string;
  fullName: string;
  phone: string;
  licensePlate: string;
  vehicleType: string;
  status: DriverStatus;
  currentTripId: string | null;
  reservationId: string | null;
  distance?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  status: string;
  roles: string[];
  createdAt: string;
}

export interface Payment {
  paymentId: string;
  tripId: string;
  riderId: string;
  driverId: string;
  amount: number;
  status: string;
  failureReason: string | null;
  correlationId: string;
  createdAt: string;
}

export interface NotificationItem {
  notificationId: string;
  recipientId: string;
  recipientRole: string;
  type: string;
  channel: string;
  content: string;
  tripId: string | null;
  correlationId: string;
  createdAt: string;
}

export interface TrackedTrip {
  tripId: string;
  ownerSessionId: string;
  createdAt: number;
}
