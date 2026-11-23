import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSession, SESSION_COOKIE, type AppRole, type SessionUser } from '@/lib/session';

export const GATEWAY_URL = (process.env.GATEWAY_URL || 'http://localhost:8080').replace(/\/$/, '');

export function currentToken(): string | null {
  return cookies().get(SESSION_COOKIE)?.value ?? null;
}

export function currentUser(): SessionUser | null {
  return readSession(currentToken());
}

/** Dùng trong server component: bắt buộc đăng nhập với đúng vai trò, nếu không thì chuyển hướng. */
export function requireUser(role?: AppRole): SessionUser {
  const user = currentUser();
  if (!user) redirect('/dang-nhap');
  if (role && user.role !== role) redirect(user.role === 'ROLE_DRIVER' ? '/tai-xe' : '/khach-hang');
  return user;
}

export interface GatewayResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** Gọi API Gateway từ server, kèm JWT trong cookie. Dữ liệu luôn lấy mới, không cache. */
export async function gateway<T>(path: string, init: RequestInit = {}): Promise<GatewayResult<T>> {
  const token = currentToken();
  try {
    const response = await fetch(`${GATEWAY_URL}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (response.status === 401 && token) redirect('/dang-nhap?het-han=1');
    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? (data as T) : null,
      error: response.ok ? null : extractError(data, response.status),
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error;
    if (typeof error === 'object' && error && 'digest' in error) throw error;
    return { ok: false, status: 0, data: null, error: 'Hệ thống đang bận, vui lòng thử lại sau.' };
  }
}

export function extractError(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>;
    if (body.errors && typeof body.errors === 'object') return Object.values(body.errors as Record<string, string>).join('. ');
    const message = body.message ?? body.error;
    if (typeof message === 'string' && message) return message;
  }
  if (status === 503 || status === 504) return 'Dịch vụ tạm thời gián đoạn, vui lòng thử lại sau ít phút.';
  if (status === 429) return 'Bạn thao tác quá nhanh, vui lòng thử lại sau vài giây.';
  return `Không thực hiện được yêu cầu (mã ${status}).`;
}
