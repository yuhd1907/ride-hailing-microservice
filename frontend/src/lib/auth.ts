'use client';

import { api, decodeJwt, errorMessage } from './api';
import { actions } from './store';
import type { Session } from './types';

interface JwtResponse {
  token: string;
  userId: string;
  email: string;
  roles: string[];
  expiresIn: number;
}

export const SEED_PASSWORD = 'Password@123';
export const SEED_ACCOUNTS = [
  { email: 'passenger1@ridehail.com', label: 'Hành khách 1' },
  { email: 'passenger2@ridehail.com', label: 'Hành khách 2' },
  { email: 'driver1@ridehail.com', label: 'Tài xế 1' },
];

/** Đăng nhập, lưu phiên vào kho và đặt làm phiên đang dùng. */
export async function login(email: string, password: string): Promise<{ session?: Session; error?: string }> {
  const result = await api<JwtResponse>('/auth/login', { session: null, body: { email, password } });
  if (!result.ok || !result.data?.token) return { error: errorMessage(result) };
  const claims = decodeJwt(result.data.token);
  const exp = typeof claims?.exp === 'number' ? claims.exp * 1000 : Date.now() + 3600_000;
  const session: Session = {
    id: result.data.userId,
    email: result.data.email,
    userId: result.data.userId,
    roles: result.data.roles ?? [],
    token: result.data.token,
    expiresAt: exp,
  };
  actions.addSession(session);
  return { session };
}
