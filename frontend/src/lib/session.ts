// Dùng được ở cả Edge middleware, route handler và server component (không phụ thuộc Node).

export const SESSION_COOKIE = 'rf_session';

export type AppRole = 'ROLE_PASSENGER' | 'ROLE_DRIVER';

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  roles: string[];
  role: AppRole | null;
  expiresAt: number;
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Đọc thông tin người dùng từ JWT để định tuyến giao diện. Không kiểm tra chữ ký: chữ ký,
 * hạn dùng và blacklist do API Gateway kiểm tra ở mọi request gọi dữ liệu.
 */
export function readSession(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  try {
    const claims = JSON.parse(base64UrlDecode(token.split('.')[1] ?? '')) as Record<string, unknown>;
    const expiresAt = typeof claims.exp === 'number' ? claims.exp * 1000 : 0;
    if (!claims.sub || expiresAt <= Date.now()) return null;
    const roles = String(claims.roles ?? '')
      .split(',')
      .map(r => r.trim())
      .filter(Boolean);
    const role: AppRole | null = roles.includes('ROLE_DRIVER') ? 'ROLE_DRIVER' : roles.includes('ROLE_PASSENGER') ? 'ROLE_PASSENGER' : null;
    return {
      userId: String(claims.sub),
      email: String(claims.email ?? ''),
      fullName: claims.fullName ? String(claims.fullName) : null,
      phone: claims.phone ? String(claims.phone) : null,
      roles,
      role,
      expiresAt,
    };
  } catch {
    return null;
  }
}

/** Trang chủ của từng vai trò. */
export function homeOf(role: AppRole | null): string {
  return role === 'ROLE_DRIVER' ? '/tai-xe' : role === 'ROLE_PASSENGER' ? '/khach-hang' : '/';
}
