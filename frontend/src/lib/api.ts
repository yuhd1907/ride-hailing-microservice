'use client';

import { actions, getState } from './store';
import type { ApiResult, Session } from './types';

const BASE = '/gw';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Phiên dùng để gửi token. Mặc định là phiên đang chọn; null = gọi không token. */
  session?: Session | null;
  headers?: Record<string, string>;
  /** Không ghi vào nhật ký request (dùng cho thăm dò định kỳ). */
  silent?: boolean;
}

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activeSession(): Session | null {
  const s = getState();
  return s.sessions.find(x => x.id === s.activeSessionId) ?? null;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const session = options.session === undefined ? activeSession() : options.session;
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) headers.Authorization = `Bearer ${session.token}`;

  const started = performance.now();
  let status = 0;
  let data: unknown = null;
  let correlationId: string | null = null;
  let instance: string | null = null;

  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    });
    status = response.status;
    correlationId = response.headers.get('X-Correlation-ID');
    instance = response.headers.get('X-Handled-By-Instance');
    const text = await response.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
  } catch (error) {
    data = { error: 'Không kết nối được tới Gateway', detail: String(error) };
  }

  const durationMs = Math.round(performance.now() - started);
  if (!options.silent) {
    actions.addLog({
      id: newId(),
      at: Date.now(),
      method,
      path,
      status,
      durationMs,
      correlationId,
      instance,
      actor: session?.email ?? null,
      requestBody: options.body,
      responseBody: data,
    });
  }

  return { ok: status >= 200 && status < 300, status, data: data as T, durationMs, correlationId, instance };
}

export function errorMessage(result: ApiResult): string {
  // Gateway luôn gắn X-Correlation-ID; 500 mà thiếu header này là do proxy Next.js không gọi được Gateway.
  const proxyDown = result.status === 500 && !result.correlationId;
  if (result.status === 0 || proxyDown) return 'Không kết nối được tới Gateway. Kiểm tra Docker Compose đã chạy chưa.';
  const body = result.data as Record<string, unknown> | string | null;
  if (body && typeof body === 'object') {
    const candidate = body.message ?? body.error ?? body.detail;
    if (typeof candidate === 'string' && candidate) return `${result.status}: ${candidate}`;
    if (body.errors && typeof body.errors === 'object') {
      return `${result.status}: ${Object.values(body.errors as Record<string, string>).join('; ')}`;
    }
  }
  if (typeof body === 'string' && body) return `${result.status}: ${body.slice(0, 200)}`;
  return `HTTP ${result.status}`;
}

/** Giải mã phần payload của JWT (không xác thực chữ ký, chỉ để hiển thị). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

export { newId };
