'use client';

import { Bell, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { call } from '@/lib/client';
import { NOTIFICATION_TYPE } from '@/lib/labels';
import type { NotificationItem } from '@/lib/types';

const POLL_MS = 5000;
const TOAST_MS = 8000;
const MAX_TOASTS = 3;

// Mốc thời gian lưu theo từng tài khoản: "seen" = đã bật hộp thông báo, "read" = đã mở trang Thông báo.
const keyOf = (userId: string, kind: 'seen' | 'read') => `rideflow:notifications:${kind}:${userId}`;

function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Trình duyệt chặn localStorage: vẫn chạy, chỉ không nhớ qua lần tải trang.
  }
}

const newest = (list: NotificationItem[]) => list.reduce((max, n) => (n.createdAt > max ? n.createdAt : max), '');

/**
 * Chuông thông báo: hỏi GET /notifications/me mỗi 5 giây, bật hộp thông báo cho thông báo mới
 * và đếm số chưa đọc. Mở trang Thông báo thì coi như đã đọc hết.
 */
export default function NotificationBell({ userId, href, tripHref }: { userId: string; href: string; tripHref: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const [readAt, setReadAt] = useState<string | null>(null);
  const seenRef = useRef<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const onPage = pathname === href;

  const poll = useCallback(async () => {
    const r = await call<NotificationItem[]>('/notifications/me?limit=20');
    if (!r.ok || !r.data) return;
    const list = r.data;
    setItems(list);
    const top = newest(list);
    // Lần đầu trên máy này: không bật lại các thông báo cũ.
    if (seenRef.current === null) {
      seenRef.current = load(keyOf(userId, 'seen')) ?? top;
      save(keyOf(userId, 'seen'), seenRef.current);
      if (load(keyOf(userId, 'read')) === null) save(keyOf(userId, 'read'), top);
      setReadAt(load(keyOf(userId, 'read')));
    }
    const fresh = list.filter(n => n.createdAt > (seenRef.current ?? '')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (fresh.length === 0) return;
    seenRef.current = top;
    save(keyOf(userId, 'seen'), top);
    setToasts(prev => [...prev, ...fresh].slice(-MAX_TOASTS));
    // Trang đang xem (chuyến, bảng điều khiển, thông báo) tải lại dữ liệu từ server.
    router.refresh();
  }, [userId, router]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  // Đang ở trang Thông báo: đánh dấu đã đọc tới thông báo mới nhất.
  useEffect(() => {
    if (!onPage || items.length === 0) return;
    const top = newest(items);
    save(keyOf(userId, 'read'), top);
    setReadAt(top);
  }, [onPage, items, userId]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => setToasts(prev => prev.slice(1)), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const unread = readAt === null ? 0 : items.filter(n => n.createdAt > readAt).length;
  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.notificationId !== id));

  return (
    <>
      <Link
        href={href}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-neutral-300 hover:bg-white/10 hover:text-white"
        aria-label={unread ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>

      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[1100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6" aria-live="polite">
            {toasts.map(t => (
              <div key={t.notificationId} className="pointer-events-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <Bell className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900">{NOTIFICATION_TYPE[t.type] ?? t.type}</div>
                    <p className="mt-0.5 text-sm text-slate-600">{t.content}</p>
                    {t.tripId && (
                      <Link href={`${tripHref}/${t.tripId}`} onClick={() => dismiss(t.notificationId)} className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">
                        Xem chuyến
                      </Link>
                    )}
                  </div>
                  <button type="button" onClick={() => dismiss(t.notificationId)} className="text-slate-400 hover:text-slate-600" aria-label="Đóng">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>,
          // Header dùng backdrop-blur: phần tử fixed bên trong bị định vị theo header, nên gắn vào body.
          document.body,
        )}
    </>
  );
}
