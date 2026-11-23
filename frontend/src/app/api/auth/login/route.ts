import { NextResponse } from 'next/server';
import { loginAndSetCookie } from '@/lib/server/auth';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  if (!body?.email || !body.password) return NextResponse.json({ error: 'Vui lòng nhập email và mật khẩu.' }, { status: 400 });
  return loginAndSetCookie(body.email, body.password);
}
