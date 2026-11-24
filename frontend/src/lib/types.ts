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
  paymentMethod?: PaymentMethod;
  /** Giá trước khi áp voucher; fare là giá cuối khách trả. */
  originalFare?: string | number | null;
  discountAmount?: string | number | null;
  voucherCode?: string | null;
  paymentId: string | null;
  sagaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VehicleType = 'MOTORCYCLE' | 'CAR_4_SEAT' | 'CAR_7_SEAT';

export type PaymentMethod = 'BANK' | 'CASH';

export interface FareEstimate {
  estimatedDistance: number;
  fareAmount: number;
  currency: string;
  pricingVersion: string;
  vehicleType?: VehicleType;
  options?: FareOption[];
  /** Chỉ có khi gửi voucherCode: fareAmount là giá sau giảm. */
  originalFare?: number;
  discountAmount?: number;
  voucherCode?: string;
  voucherApplicable?: boolean;
  voucherReason?: string | null;
}

/** Voucher khách còn dùng được (GET /trips/vouchers). */
export interface Voucher {
  code: string;
  description: string;
  discountType: 'PERCENT' | 'FIXED';
  value: number;
  maxDiscount: number | null;
  minFare: number;
  vehicleType: VehicleType | null;
  validFrom: string;
  validTo: string;
}

/** Tài khoản ngân hàng ảo của Payment Service: available = balance - held. */
export interface BankAccount {
  userId: string;
  balance: number;
  held: number;
  available: number;
}

export type BankTransactionType = 'TOPUP' | 'HOLD' | 'RELEASE' | 'CAPTURE' | 'ADJUST_UP' | 'ADJUST_DOWN';

export interface BankTransaction {
  id: string;
  type: BankTransactionType;
  amount: number;
  tripId: string | null;
  balanceAfter: number;
  availableAfter: number;
  createdAt: string;
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
  method?: PaymentMethod;
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
