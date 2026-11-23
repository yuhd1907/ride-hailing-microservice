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
  'Driver offer expired': 'Cuốc đã hết thời gian xác nhận (60 giây) và sẽ được chuyển cho tài xế khác.',
  'Trip can no longer be cancelled': 'Chuyến đã bắt đầu, không thể hủy.',
  'Trip is not in progress': 'Chuyến chưa bắt đầu.',
  'Driver can no longer reject this trip': 'Không thể từ chối chuyến này nữa.',
  'Only the assigned driver can perform this action': 'Chỉ tài xế được giao chuyến mới thực hiện được.',
  'Trip not found': 'Không tìm thấy chuyến đi.',
  'Invalid pickup or destination': 'Điểm đón hoặc điểm đến không hợp lệ.',
  'Service temporarily unavailable': 'Dịch vụ tạm thời gián đoạn, vui lòng thử lại.',
};

function translate(message: string) {
  return MESSAGES[message] ?? message;
}

/** Gọi API qua proxy BFF /api/gw; cookie phiên được trình duyệt gửi kèm tự động. */
export async function call<T>(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<CallResult<T>> {
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
