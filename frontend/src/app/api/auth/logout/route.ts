import { NextResponse } from 'next/server';
import { currentToken, GATEWAY_URL } from '@/lib/server/gateway';
import { SESSION_COOKIE } from '@/lib/session';

/** Thu hồi token ở backend (blacklist Redis) rồi xóa cookie phiên. */
export async function POST() {
  const token = currentToken();
  if (token) {
    await fetch(`${GATEWAY_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => undefined);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
