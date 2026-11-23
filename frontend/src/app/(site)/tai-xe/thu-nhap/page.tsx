import type { Metadata } from 'next';
import { Container, EmptyState, ErrorState, PageTitle, Panel, Stat } from '@/components/site/Blocks';
import { vnd } from '@/lib/format';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Thu nhập' };

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default async function DriverEarnings() {
  requireUser('ROLE_DRIVER');
  // Thu nhập = cước của các chuyến đã thanh toán thành công (trạng thái CONFIRMED trong trip_db).
  const trips = await gateway<Trip[]>('/trips/me?status=CONFIRMED&limit=100');
  const done = trips.data ?? [];

  const byDay = new Map<string, { count: number; total: number; distance: number }>();
  for (const t of done) {
    const key = dayKey(t.updatedAt);
    const row = byDay.get(key) ?? { count: 0, total: 0, distance: 0 };
    row.count += 1;
    row.total += Number(t.fare);
    row.distance += Number(t.estimatedDistance);
    byDay.set(key, row);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const week = done.filter(t => new Date(t.updatedAt).getTime() >= weekAgo);
  const total = done.reduce((s, t) => s + Number(t.fare), 0);
  const max = Math.max(1, ...days.map(([, r]) => r.total));

  return (
    <Container>
      <PageTitle title="Thu nhập" subtitle="Tính từ các chuyến đã hoàn thành và thanh toán thành công (100 chuyến gần nhất)" />
      {trips.error && <ErrorState message={trips.error} />}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="7 ngày qua" value={vnd(week.reduce((s, t) => s + Number(t.fare), 0))} hint={`${week.length} chuyến`} />
        <Stat label="Tổng cộng" value={vnd(total)} hint={`${done.length} chuyến`} />
        <Stat label="Trung bình mỗi chuyến" value={vnd(done.length ? Math.round(total / done.length) : 0)} />
      </div>
      <Panel title="Theo ngày" padded={false}>
        {days.length === 0 ? (
          <EmptyState title="Chưa có thu nhập" description="Thu nhập được ghi nhận sau khi khách thanh toán thành công." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Ngày</th>
                <th className="px-5 py-3 text-right font-medium">Số chuyến</th>
                <th className="hidden px-5 py-3 text-right font-medium sm:table-cell">Quãng đường</th>
                <th className="px-5 py-3 font-medium">Thu nhập</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {days.map(([day, r]) => (
                <tr key={day}>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-700">{new Date(`${day}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
                  <td className="px-5 py-3 text-right">{r.count}</td>
                  <td className="hidden px-5 py-3 text-right text-slate-500 sm:table-cell">{r.distance.toFixed(1)} km</td>
                  <td className="w-1/2 px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-brand-600" style={{ width: `${(r.total / max) * 100}%` }} />
                      </div>
                      <span className="w-28 text-right font-semibold text-slate-900">{vnd(r.total)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Container>
  );
}
