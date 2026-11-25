import { Bell, Megaphone, Pin } from 'lucide-react';
import Link from 'next/link';
import { Container, EmptyState, ErrorState, PageTitle, Panel } from './Blocks';
import Pill from './Pill';
import { time } from '@/lib/format';
import { ANNOUNCEMENT_CATEGORY, NOTIFICATION_TYPE } from '@/lib/labels';
import { gateway } from '@/lib/server/gateway';
import type { Announcement, NotificationItem } from '@/lib/types';

/**
 * Hộp thư thông báo (notification_db): thông báo chung của nền tảng theo vai trò
 * (GET /notifications/announcements) và thông báo về chuyến của chính người dùng (GET /notifications/me).
 */
export default async function NotificationsPage({ tripHref }: { tripHref: string }) {
  const [result, news] = await Promise.all([gateway<NotificationItem[]>('/notifications/me?limit=100'), gateway<Announcement[]>('/notifications/announcements?limit=20')]);
  const list = [...(result.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const announcements = news.data ?? [];

  return (
    <Container className="max-w-3xl">
      <PageTitle title="Thông báo" />
      {result.error && <ErrorState message={result.error} />}

      {announcements.length > 0 && (
        <Panel
          className="mb-6"
          padded={false}
          title={
            <span className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-brand-600" /> Tin từ Gogo
            </span>
          }
        >
          <ul className="divide-y divide-slate-100">
            {announcements.map(a => {
              const cat = ANNOUNCEMENT_CATEGORY[a.category] ?? { label: a.category, tone: 'gray' as const };
              return (
                <li key={a.announcementId}>
                  <details className="group px-5 py-4" open={a.pinned}>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        {a.pinned && <Pin className="h-3.5 w-3.5 text-brand-600" />}
                        {a.title}
                      </span>
                      <span className="flex items-center gap-2">
                        <Pill tone={cat.tone}>{cat.label}</Pill>
                        <span className="text-xs text-slate-400">{time(a.publishedAt)}</span>
                      </span>
                    </summary>
                    <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{a.content}</p>
                    {a.expiresAt && <p className="mt-1 text-xs text-slate-400">Hiệu lực đến {time(a.expiresAt)}</p>}
                  </details>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Panel padded={false} title="Hoạt động của bạn">
        {list.length === 0 ? (
          <EmptyState title="Chưa có thông báo" description="Bạn sẽ nhận thông báo khi có tài xế nhận chuyến hoặc khi thanh toán xong." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map(n => (
              <li key={n.notificationId} className="flex gap-4 px-5 py-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <Bell className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">{NOTIFICATION_TYPE[n.type] ?? n.type}</span>
                    <span className="text-xs text-slate-400">{time(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-600">{n.content}</p>
                  {n.tripId && (
                    <Link href={`${tripHref}/${n.tripId}`} className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">
                      Xem chuyến
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Container>
  );
}
