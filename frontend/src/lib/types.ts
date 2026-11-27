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
  /** Báo giá đã khóa khi đặt (giá động): giữ nguyên lý do tăng giá tại thời điểm đặt. */
  pricingSnapshot?: PricingSnapshot | null;
  /** Bước khi đang chạy (status IN_PROGRESS): null/TO_PICKUP đang tới đón, ARRIVED đã tới, ON_BOARD khách đã lên xe. */
  tripPhase?: TripPhase | null;
  arrivedAt?: string | null;
  pickedUpAt?: string | null;
  cancelledBy?: 'PASSENGER' | 'DRIVER' | null;
  cancelReason?: DriverCancelReason | null;
  /** Ghi chú khách gửi tài xế khi đặt xe. */
  noteForDriver?: string | null;
  /** Tuyến khách chọn khi đặt (Google encoded polyline); tài xế được dẫn đường theo tuyến này. */
  routePolyline?: string | null;
  paymentId: string | null;
  sagaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VehicleType = 'MOTORCYCLE' | 'CAR_4_SEAT' | 'CAR_7_SEAT';

export type TripPhase = 'TO_PICKUP' | 'ARRIVED' | 'ON_BOARD';
export type DriverCancelReason = 'PASSENGER_NO_SHOW' | 'PASSENGER_REQUEST' | 'VEHICLE_PROBLEM' | 'SAFETY';

/** Một ô của bản đồ nhu cầu (GET /trips/demand-map). */
export interface DemandCell {
  cellId: string;
  center: { lat: number; lng: number };
  bounds: { north: number; south: number; east: number; west: number };
  demand: number;
  availableDrivers: number;
  recentRequests: number;
  multiplier: number;
}

export interface DemandMap {
  vehicleType: VehicleType;
  cellSizeKm: number;
  radiusKm: number;
  recentMinutes: number;
  maxMultiplier: number;
  supplyKnown: boolean;
  generatedAt: string;
  cells: DemandCell[];
}

/** Vị trí tài xế của chuyến (GET /trips/{id}/driver-location), cho khách theo dõi. */
export interface DriverLocationInfo {
  tripId: string;
  driverId: string;
  position: { lat: number; lng: number };
  updatedAt: string;
  stale: boolean;
  target: 'PICKUP' | 'DESTINATION';
  remainingKm: number;
  etaMinutes: number;
}

/** Tip của khách cho chuyến (amount = null nếu chưa tip). */
export interface TipInfo {
  tripId: string;
  amount: number | null;
  tippedAt: string | null;
}

/** Người thân để Trung tâm an toàn liên hệ (user_db). */
export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
  createdAt: string;
}

export interface TripRating {
  tripId: string;
  passengerId: string;
  driverId: string;
  stars: number;
  tags: string[];
  comment: string | null;
  createdAt: string;
}

export interface RatingSummary {
  driverId: string;
  average: number | null;
  count: number;
}

/** Chỉ số hoạt động của tài xế (GET /trips/drivers/me/stats). */
export interface DriverStats {
  days: number;
  accepted: number;
  declined: number;
  driverCancelled: number;
  completed: number;
  acceptanceRate: number | null;
  cancellationRate: number | null;
  rating: {
    average: number | null;
    count: number;
    distribution: Record<string, number>;
    tags: { tag: string; count: number }[];
    recent: { stars: number; tags: string[]; comment: string | null; createdAt: string }[];
  };
}

export type TicketCategory =
  | 'PASSENGER_NO_SHOW'
  | 'WRONG_LOCATION'
  | 'WRONG_FARE'
  | 'PAYMENT'
  | 'SAFETY'
  | 'DRIVER_BEHAVIOR'
  | 'LOST_ITEM'
  | 'ACCOUNT'
  | 'OTHER';

export interface SupportTicket {
  id: string;
  userId: string;
  role: 'PASSENGER' | 'DRIVER';
  tripId: string | null;
  category: TicketCategory;
  subject: string;
  description: string;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED';
  createdAt: string;
  updatedAt: string;
}

export interface Announcement {
  announcementId: string;
  audience: 'ALL' | 'PASSENGER' | 'DRIVER';
  category: 'POLICY' | 'MAINTENANCE' | 'PROMOTION' | 'NEWS';
  title: string;
  content: string;
  pinned: boolean;
  publishedAt: string;
  expiresAt: string | null;
}

export type BankTransactionType =
  | 'TOPUP'
  | 'HOLD'
  | 'RELEASE'
  | 'CAPTURE'
  | 'ADJUST_UP'
  | 'ADJUST_DOWN'
  | 'EARNING'
  | 'COMMISSION'
  | 'WITHDRAW'
  | 'TIP_SENT'
  | 'TIP_RECEIVED';

export interface BankTransaction {
  id: string;
  type: BankTransactionType;
  amount: number;
  tripId: string | null;
  balanceAfter: number;
  availableAfter: number;
  createdAt: string;
}

export interface WalletPolicy {
  commissionRate: number;
  minWithdraw: number;
  maxWithdraw: number;
}

/** Một lý do làm giá thay đổi: hệ số nhân (giờ cao điểm, mưa…) hoặc phụ phí cộng thêm (khu vực). */
export interface PricingReason {
  code: string;
  label: string;
  multiplier?: number;
  amount?: number;
}

/** Chi tiết cách Trip Service tính giá động (pricing-policy.js, phiên bản dynamic-v1). */
export interface PricingBreakdown {
  baseFare: number;
  perKm: number;
  perMinute: number;
  distanceFare: number;
  durationFare: number;
  subtotal: number;
  minimumFare: number;
  multipliers: { time: number; surge: number; calendar: number; weather: number };
  combinedMultiplier: number;
  zoneSurcharge: number;
  roundingAdjustment: number;
  reasons: PricingReason[];
  timezone?: string;
  localDate?: string;
}

export interface SurgeInfo {
  status: string;
  multiplier: number;
  demand?: number;
  availableDrivers?: number;
  radiusKm?: number;
}

export interface WeatherInfo {
  status: string;
  raining?: boolean;
  condition?: string;
}

/** Phần chung của báo giá và ảnh chụp giá lưu trong chuyến. */
export interface PricingSnapshot {
  estimatedDistance: number;
  estimatedDuration?: number;
  fareAmount: number;
  currency?: string;
  pricingVersion?: string;
  breakdown?: PricingBreakdown;
  surge?: SurgeInfo;
  weather?: WeatherInfo;
  notices?: string[];
  distanceSource?: string;
  expiresAt?: string;
}

export interface FareEstimate extends PricingSnapshot {
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

/** BANK: tài khoản ngân hàng ảo (khóa tiền khi đặt); CASH: tài xế xác nhận đã thu khi kết thúc. */
export type PaymentMethod = 'BANK' | 'CASH';

export interface FareOption extends FareEstimate {
  /** Mã báo giá gửi lại khi đặt xe để khóa đúng giá đã hiển thị. */
  quoteId: string;
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
  latitude?: number | null;
  longitude?: number | null;
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
