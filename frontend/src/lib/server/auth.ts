import { NextResponse } from 'next/server';
import { homeOf, readSession, SESSION_COOKIE } from '@/lib/session';
import { extractError, GATEWAY_URL } from './gateway';

/** Đăng nhập qua Gateway; thành công thì đặt JWT vào cookie httpOnly. */
export async function loginAndSetCookie(email: string, password: string) {
  let response: Response;
  try {
    response = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Không kết nối được máy chủ, vui lòng thử lại.' }, { status: 503 });
  }
  const data = (await response.json().catch(() => null)) as { token?: string } | null;
  if (!response.ok || !data?.token) {
    const message =
      response.status === 401 || response.status === 400 ? 'Email hoặc mật khẩu không đúng.' : extractError(data, response.status);
    return NextResponse.json({ error: message }, { status: response.status || 500 });
  }
  const user = readSession(data.token);
  if (!user?.role) return NextResponse.json({ error: 'Tài khoản không có vai trò hợp lệ.' }, { status: 403 });

  const result = NextResponse.json({ user, redirectTo: homeOf(user.role) });
  result.cookies.set(SESSION_COOKIE, data.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIE !== '1',
    path: '/',
    maxAge: Math.max(0, Math.floor((user.expiresAt - Date.now()) / 1000)),
  });
  return result;
}
