import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Container, EmptyState, ErrorState, PageTitle, Panel } from './Blocks';
import { time } from '@/lib/format';
import { NOTIFICATION_TYPE } from '@/lib/labels';
import { gateway } from '@/lib/server/gateway';
import type { NotificationItem } from '@/lib/types';

/** Thông báo của người đang đăng nhập (notification_db, GET /notifications/me). */
export default async function NotificationsPage({ tripHref }: { tripHref: string }) {
  const result = await gateway<NotificationItem[]>('/notifications/me?limit=100');
  const list = [...(result.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <Container className="max-w-3xl">
      <PageTitle title="Thông báo" />
      {result.error && <ErrorState message={result.error} />}
      <Panel padded={false}>
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
