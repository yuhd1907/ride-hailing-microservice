'use client';

import { RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Input, JsonBlock, Mono, PageHeader, StatusBadge, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { shortId, time, vnd } from '@/lib/format';
import { useAction, useInterval, useMounted } from '@/lib/hooks';
import { useActiveSession } from '@/lib/store';
import type { NotificationItem, Payment } from '@/lib/types';

export default function PaymentsPage() {
  const mounted = useMounted();
  const session = useActiveSession();
  const payments = useAction(() => api<Payment[]>('/payments/me', { silent: true }));
  const notifications = useAction(() => api<NotificationItem[]>('/notifications/me', { silent: true }));
  const [auto, setAuto] = useState(true);

  const refresh = useCallback(() => {
    void payments.run();
    void notifications.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    if (session) refresh();
  }, [refresh, session]);
  useInterval(refresh, 5000, auto && !!session);

  if (!mounted) return null;

  return (
    <>
      <PageHeader
        title="Thanh toán & thông báo"
        description="Kết quả Saga: trip.completed → Payment thu tiền (outbox) → payment.succeeded / payment.failed → Notification gửi cho khách và tài xế."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
              Tự làm mới (5 giây)
            </label>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={refresh}>
              Làm mới
            </Button>
          </>
        }
      />
      {!session && <Alert kind="error">Cần chọn một phiên đăng nhập.</Alert>}
      {session && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title="Thanh toán của tôi" description={`GET /payments/me · ${session.email}`}>
            {payments.error && <Alert kind="error">{payments.error}</Alert>}
            {!payments.result?.ok || payments.result.data.length === 0 ? (
              <Empty>Chưa có giao dịch. Hoàn thành một chuyến để Payment thu tiền.</Empty>
            ) : (
              <Table head={['Thời gian', 'Chuyến', 'Số tiền', 'Trạng thái', 'Lý do lỗi']}>
                {[...payments.result.data]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map(p => (
                    <tr key={p.paymentId}>
                      <Td>{time(p.createdAt)}</Td>
                      <Td>
                        <Mono>{shortId(p.tripId)}</Mono>
                      </Td>
                      <Td className="font-medium">{vnd(p.amount)}</Td>
                      <Td>
                        <StatusBadge status={p.status} />
                      </Td>
                      <Td className="text-slate-500">{p.failureReason ?? '—'}</Td>
                    </tr>
                  ))}
              </Table>
            )}
          </Card>

          <Card title="Thông báo của tôi" description={`GET /notifications/me · ${session.email}`}>
            {notifications.error && <Alert kind="error">{notifications.error}</Alert>}
            {!notifications.result?.ok || notifications.result.data.length === 0 ? (
              <Empty>Chưa có thông báo.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...notifications.result.data]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map(n => (
                    <li key={n.notificationId} className="py-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge color={n.type.includes('FAIL') || n.type.includes('COMPENSATED') ? 'red' : n.type.includes('SUCCEEDED') ? 'green' : 'blue'}>
                          {n.type}
                        </Badge>
                        <span className="text-xs text-slate-400">{time(n.createdAt)}</span>
                        <span className="text-xs text-slate-400">· {n.channel}</span>
                      </div>
                      <div className="text-sm text-slate-800">{n.content}</div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        chuyến <Mono>{shortId(n.tripId)}</Mono> · correlationId <Mono>{n.correlationId}</Mono>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <PaymentByTripCard />
        </div>
      )}
    </>
  );
}

function PaymentByTripCard() {
  const [tripId, setTripId] = useState('');
  const lookup = useAction(() => api<Payment>(`/payments/trips/${tripId.trim()}`));
  return (
    <Card title="Tra thanh toán theo chuyến" description="GET /payments/trips/{tripId} — chỉ khách hoặc tài xế của chuyến mới xem được" className="xl:col-span-2">
      <form
        className="mb-4 flex gap-2"
        onSubmit={e => {
          e.preventDefault();
          if (tripId.trim()) void lookup.run();
        }}
      >
        <Input value={tripId} onChange={e => setTripId(e.target.value)} placeholder="tripId (UUID)" className="max-w-md" />
        <Button type="submit" variant="secondary" icon={<Search className="h-4 w-4" />} loading={lookup.loading}>
          Tra cứu
        </Button>
      </form>
      {lookup.error && <Alert kind="error">{lookup.error}</Alert>}
      {lookup.result?.ok && <JsonBlock value={lookup.result.data} />}
    </Card>
  );
}
