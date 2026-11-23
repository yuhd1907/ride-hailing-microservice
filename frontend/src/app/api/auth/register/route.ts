import { NextResponse } from 'next/server';
import { extractError, GATEWAY_URL } from '@/lib/server/gateway';
import { loginAndSetCookie } from '@/lib/server/auth';

interface RegisterBody {
  email?: string;
  password?: string;
  fullName?: string;
  phone?: string;
  role?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as RegisterBody | null;
  if (!body?.email || !body.password || !body.fullName || !body.phone) {
    return NextResponse.json({ error: 'Vui lòng điền đầy đủ thông tin.' }, { status: 400 });
  }
  if (body.role !== 'ROLE_PASSENGER' && body.role !== 'ROLE_DRIVER') {
    return NextResponse.json({ error: 'Vai trò không hợp lệ.' }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${GATEWAY_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: body.email, password: body.password, fullName: body.fullName, phone: body.phone, role: body.role }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Không kết nối được máy chủ, vui lòng thử lại.' }, { status: 503 });
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    return NextResponse.json({ error: extractError(data, response.status) }, { status: response.status });
  }
  return loginAndSetCookie(body.email, body.password);
}
