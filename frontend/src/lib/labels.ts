import type { DriverStatus, TripStatus } from './types';

export type Tone = 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'violet';

export const TRIP_STATUS: Record<TripStatus, { label: string; tone: Tone }> = {
  REQUESTED: { label: 'Đã gửi yêu cầu', tone: 'gray' },
  MATCHING: { label: 'Đang tìm tài xế', tone: 'blue' },
  AWAITING_DRIVER: { label: 'Chờ tài xế xác nhận', tone: 'amber' },
  IN_PROGRESS: { label: 'Đang di chuyển', tone: 'violet' },
  PAYMENT_PENDING: { label: 'Đang thanh toán', tone: 'amber' },
  CONFIRMED: { label: 'Hoàn thành', tone: 'green' },
  COMPLETED: { label: 'Hoàn thành', tone: 'green' },
  CANCELLED: { label: 'Đã hủy', tone: 'gray' },
  FAILED: { label: 'Không thành công', tone: 'red' },
};

export const OPEN_TRIP: TripStatus[] = ['REQUESTED', 'MATCHING', 'AWAITING_DRIVER', 'IN_PROGRESS', 'PAYMENT_PENDING'];
export const CANCELLABLE: TripStatus[] = ['REQUESTED', 'MATCHING', 'AWAITING_DRIVER'];

export const DRIVER_STATUS: Record<DriverStatus, { label: string; tone: Tone }> = {
  OFFLINE: { label: 'Ngoại tuyến', tone: 'gray' },
  AVAILABLE: { label: 'Đang nhận cuốc', tone: 'green' },
  RESERVED: { label: 'Có cuốc mới', tone: 'amber' },
  ON_TRIP: { label: 'Đang chở khách', tone: 'violet' },
};

export const VEHICLE: Record<string, string> = {
  MOTORCYCLE: 'Xe máy',
  CAR_4_SEAT: 'Ô tô 4 chỗ',
  CAR_7_SEAT: 'Ô tô 7 chỗ',
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  SUCCESS: { label: 'Thành công', tone: 'green' },
  FAILED: { label: 'Thất bại', tone: 'red' },
  PENDING: { label: 'Đang xử lý', tone: 'amber' },
  REFUNDED: { label: 'Đã hoàn tiền', tone: 'blue' },
};

export const FAILURE_REASON: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Số dư không đủ',
  PAYMENT_DECLINED: 'Giao dịch bị từ chối',
  INTERNAL_ERROR: 'Lỗi hệ thống thanh toán',
};

export const NOTIFICATION_TYPE: Record<string, string> = {
  DRIVER_ASSIGNED: 'Đã tìm thấy tài xế',
  PAYMENT_SUCCEEDED: 'Thanh toán thành công',
  PAYMENT_FAILED: 'Thanh toán thất bại',
  TRIP_COMPENSATED: 'Chuyến được hoàn tác',
  TRIP_FAILED: 'Chuyến không thành công',
  TRIP_ACCEPTED: 'Tài xế đã nhận chuyến',
};

export const PAYMENT_METHOD: Record<string, string> = {
  BANK: 'Ngân hàng',
  CASH: 'Tiền mặt',
};

/** Lý do Trip Service trả khi voucher không áp dụng được cho lựa chọn hiện tại. */
export const VOUCHER_REASON: Record<string, string> = {
  UNAVAILABLE: 'Mã không tồn tại hoặc bạn đã dùng',
  EXPIRED: 'Mã đã hết hạn',
  VEHICLE_NOT_ELIGIBLE: 'Mã không áp dụng cho loại xe này',
  FARE_TOO_LOW: 'Giá chuyến chưa đủ để dùng mã',
};

export const BANK_TX: Record<string, { label: string; sign: 1 | -1 | 0 }> = {
  TOPUP: { label: 'Nạp tiền', sign: 1 },
  HOLD: { label: 'Khoá tiền cước', sign: 0 },
  RELEASE: { label: 'Mở khoá', sign: 0 },
  CAPTURE: { label: 'Trừ tiền cước', sign: -1 },
  ADJUST_UP: { label: 'Điều chỉnh tăng', sign: 1 },
  ADJUST_DOWN: { label: 'Điều chỉnh giảm', sign: -1 },
};

export const TRIP_REASON: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Số dư ngân hàng không đủ',
  NO_AVAILABLE_DRIVERS: 'Không có tài xế phù hợp',
};

export const coord = (p: { lat: number; lng: number } | null | undefined) =>
  p ? `${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}` : '—';
