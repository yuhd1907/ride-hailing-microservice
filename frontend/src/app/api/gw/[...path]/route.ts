import { NextResponse, type NextRequest } from 'next/server';
import { currentToken, GATEWAY_URL } from '@/lib/server/gateway';
import { SESSION_COOKIE } from '@/lib/session';

// Proxy BFF: trình duyệt gọi /api/gw/<đường dẫn>, server gắn JWT từ cookie httpOnly rồi gọi Gateway.
// Token không bao giờ lộ ra JavaScript phía trình duyệt.
// Chỉ cho phép các nhóm API công khai của Gateway; /internal và /actuator bị chặn ngay tại đây.
const ALLOWED = ['trips', 'drivers', 'users', 'payments', 'notifications'];

async function forward(request: NextRequest, { params }: { params: { path: string[] } }) {
  const [group] = params.path;
  if (!ALLOWED.includes(group)) return NextResponse.json({ error: 'Không tìm thấy' }, { status: 404 });

  const token = currentToken();
  if (!token) return NextResponse.json({ error: 'Vui lòng đăng nhập' }, { status: 401 });

  const target = `${GATEWAY_URL}/${params.path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body || undefined,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Không kết nối được máy chủ, vui lòng thử lại.' }, { status: 503 });
  }

  const response = new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  });
  const correlationId = upstream.headers.get('X-Correlation-ID');
  if (correlationId) response.headers.set('X-Correlation-ID', correlationId);
  // Token hết hạn hoặc đã bị thu hồi: xóa cookie để giao diện đưa người dùng về trang đăng nhập.
  if (upstream.status === 401) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
export const dynamic = 'force-dynamic';
