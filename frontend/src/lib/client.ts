'use client';

export interface CallResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

function messageOf(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>;
    if (body.errors && typeof body.errors === 'object') return Object.values(body.errors as Record<string, string>).join('. ');
    const message = body.message ?? body.error;
    if (typeof message === 'string' && message) return translate(message);
  }
  if (status === 0 || status === 503 || status === 504) return 'Dịch vụ tạm thời gián đoạn, vui lòng thử lại sau ít phút.';
  if (status === 429) return 'Bạn thao tác quá nhanh, vui lòng thử lại sau vài giây.';
  if (status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
  return `Không thực hiện được yêu cầu (mã ${status}).`;
}

// Một số thông báo lỗi tiếng Anh từ Trip Service, đổi sang câu dễ hiểu cho người dùng.
const MESSAGES: Record<string, string> = {
  'Trip is not awaiting driver': 'Chuyến không còn chờ tài xế xác nhận.',
  'Invalid paymentMethod': 'Phương thức thanh toán không hợp lệ.',
  'Quote expired; request a new quote': 'Báo giá đã hết hạn, vui lòng xem lại giá.',
  'Driver offer expired': 'Cuốc đã hết thời gian xác nhận (60 giây) và sẽ được chuyển cho tài xế khác.',
  'Trip can no longer be cancelled': 'Chuyến đã bắt đầu, không thể hủy.',
  'Trip is not in progress': 'Chuyến chưa bắt đầu.',
  'Driver can no longer reject this trip': 'Không thể từ chối chuyến này nữa.',
  'Only the assigned driver can perform this action': 'Chỉ tài xế được giao chuyến mới thực hiện được.',
  'Trip not found': 'Không tìm thấy chuyến đi.',
  'Invalid pickup or destination': 'Điểm đón hoặc điểm đến không hợp lệ.',
  'Service temporarily unavailable': 'Dịch vụ tạm thời gián đoạn, vui lòng thử lại.',
  'Passenger is already on board': 'Khách đã lên xe, không thể hủy chuyến.',
  'Mark arrival at pickup first': 'Bấm "Đã đến điểm đón" trước khi báo khách không xuất hiện.',
  'Wait at pickup before reporting no-show': 'Cần chờ khách ít nhất 2 phút tại điểm đón trước khi báo khách không xuất hiện.',
  'Invalid cancel reason': 'Lý do hủy không hợp lệ.',
  'Trip cannot be rated yet': 'Chỉ đánh giá được sau khi chuyến kết thúc.',
  'Trip already rated': 'Bạn đã đánh giá chuyến này rồi.',
  'Stars must be an integer from 1 to 5': 'Hãy chọn từ 1 đến 5 sao.',
  'Subject is too short': 'Tiêu đề quá ngắn (tối thiểu 3 ký tự).',
  'Description is too short': 'Mô tả quá ngắn (tối thiểu 10 ký tự).',
  'Too many tickets today': 'Bạn đã gửi quá nhiều yêu cầu hôm nay, vui lòng thử lại ngày mai.',
  'Trip is not accessible to this user': 'Bạn không tham gia chuyến này.',
  'Voucher đã được dùng': 'Bạn đã dùng mã giảm giá này rồi.',
  'Note is too long': 'Ghi chú cho tài xế tối đa 200 ký tự.',
  'Invalid note': 'Ghi chú không hợp lệ.',
  'Driver location is not available for this trip': 'Chuyến này không còn theo dõi vị trí tài xế.',
  'Driver has not shared a location yet': 'Tài xế chưa gửi vị trí.',
};

const VOUCHER_REASON: Record<string, string> = {
  UNAVAILABLE: 'mã không tồn tại hoặc bạn đã dùng',
  EXPIRED: 'mã đã hết hạn',
  VEHICLE_NOT_ELIGIBLE: 'mã không áp dụng cho loại xe này',
  FARE_TOO_LOW: 'giá chuyến chưa đủ để dùng mã',
};

function translate(message: string) {
  const voucher = /^Voucher không áp dụng được \((\w+)\)$/.exec(message);
  if (voucher) return `Không dùng được mã giảm giá: ${VOUCHER_REASON[voucher[1]] ?? voucher[1]}.`;
  return MESSAGES[message] ?? message;
}

/** Gọi API qua proxy BFF /api/gw; cookie phiên được trình duyệt gửi kèm tự động. */
export async function call<T>(path: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {}): Promise<CallResult<T>> {
  try {
    const response = await fetch(`/api/gw${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (response.status === 401) {
      window.location.href = `/dang-nhap?het-han=1&next=${encodeURIComponent(window.location.pathname)}`;
    }
    return response.ok
      ? { ok: true, status: response.status, data: data as T, error: null }
      : { ok: false, status: response.status, data: null, error: messageOf(data, response.status) };
  } catch {
    return { ok: false, status: 0, data: null, error: messageOf(null, 0) };
  }
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  window.location.href = '/';
}
