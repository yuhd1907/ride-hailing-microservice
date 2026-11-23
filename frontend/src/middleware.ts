import { NextResponse, type NextRequest } from 'next/server';
import { homeOf, readSession, SESSION_COOKIE, type AppRole } from '@/lib/session';

// Phân quyền theo khu vực: khách hàng chỉ vào /khach-hang, tài xế chỉ vào /tai-xe.
// Đây là lớp chặn giao diện; mọi API vẫn được Gateway và từng service kiểm tra quyền lần nữa.
const AREAS: { prefix: string; role: AppRole | null }[] = [
  { prefix: '/khach-hang', role: 'ROLE_PASSENGER' },
  { prefix: '/tai-xe', role: 'ROLE_DRIVER' },
  { prefix: '/tai-khoan', role: null },
];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const user = readSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/dang-nhap' || pathname === '/dang-ky') {
    return user ? NextResponse.redirect(new URL(homeOf(user.role), request.url)) : NextResponse.next();
  }

  const area = AREAS.find(a => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`));
  if (!area) return NextResponse.next();

  if (!user) {
    const login = new URL('/dang-nhap', request.url);
    login.searchParams.set('next', pathname + search);
    const response = NextResponse.redirect(login);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  if (area.role && user.role !== area.role) {
    return NextResponse.redirect(new URL(homeOf(user.role), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/khach-hang/:path*', '/tai-xe/:path*', '/tai-khoan/:path*', '/dang-nhap', '/dang-ky'],
};
