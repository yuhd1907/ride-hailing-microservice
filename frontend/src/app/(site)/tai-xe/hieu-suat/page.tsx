import clsx from 'clsx';
import { Star } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, EmptyState, ErrorState, PageTitle, Panel } from '@/components/site/Blocks';
import { time } from '@/lib/format';
import { RATING_TAG } from '@/lib/labels';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { DriverStats } from '@/lib/types';

export const metadata: Metadata = { title: 'Hiệu suất' };

const WINDOWS = [7, 30, 90];
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function Gauge({ label, value, good, detail, higherIsBetter }: { label: string; value: number | null; good: number; detail: string; higherIsBetter: boolean }) {
  const ok = value == null ? null : higherIsBetter ? value >= good : value <= good;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between text-sm text-slate-500">
        {label}
        {ok != null && <span className={clsx('rounded-full px-2 py-0.5 text-xs font-semibold', ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>{ok ? 'Tốt' : 'Cần cải thiện'}</span>}
      </div>
      <div className="mt-1 text-3xl font-bold text-slate-900">{pct(value)}</div>
      <div className="mt-3 h-2 rounded-full bg-slate-100">
        <div className={clsx('h-2 rounded-full', ok === false ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      </div>
      <div className="mt-2 text-xs text-slate-400">{detail}</div>
    </div>
  );
}

export default async function DriverPerformance({ searchParams }: { searchParams: { ngay?: string } }) {
  requireUser('ROLE_DRIVER');
  const days = WINDOWS.includes(Number(searchParams.ngay)) ? Number(searchParams.ngay) : 30;
  const result = await gateway<DriverStats>(`/trips/drivers/me/stats?days=${days}`);
  const s = result.data;
  const ratingTotal = s ? Object.values(s.rating.distribution).reduce((a, b) => a + b, 0) : 0;

  return (
    <Container>
      <PageTitle
        title="Hiệu suất"
        subtitle="Tỷ lệ nhận cuốc, tỷ lệ hủy và đánh giá của khách: ảnh hưởng tới quyền lợi và ưu tiên ghép cuốc"
        actions={
          <nav className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {WINDOWS.map(w => (
              <Link key={w} href={`?ngay=${w}`} className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium', w === days ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
                {w} ngày
              </Link>
            ))}
          </nav>
        }
      />
      {result.error && <ErrorState message={result.error} />}
      {s && (
        <>
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <Gauge label="Tỷ lệ nhận cuốc" value={s.acceptanceRate} good={0.8} higherIsBetter detail={`Nhận ${s.accepted} / ${s.accepted + s.declined} cuốc được giao (từ chối hoặc để quá 60 giây: ${s.declined})`} />
            <Gauge label="Tỷ lệ hủy chuyến" value={s.cancellationRate} good={0.05} higherIsBetter={false} detail={`Hủy ${s.driverCancelled} / ${s.accepted} chuyến đã nhận · hoàn thành ${s.completed}`} />
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm text-slate-500">Đánh giá trung bình</div>
              <div className="mt-1 flex items-center gap-2 text-3xl font-bold text-slate-900">
                {s.rating.average != null ? s.rating.average.toFixed(2) : '—'}
                <Star className="h-7 w-7 fill-amber-400 text-amber-400" />
              </div>
              <div className="mt-2 text-xs text-slate-400">{s.rating.count} lượt đánh giá (toàn thời gian)</div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Phân bố số sao">
              <div className="space-y-2">
                {[5, 4, 3, 2, 1].map(star => {
                  const n = s.rating.distribution[String(star)] ?? 0;
                  return (
                    <div key={star} className="flex items-center gap-3 text-sm">
                      <span className="flex w-10 items-center gap-1 text-slate-600">
                        {star} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      </span>
                      <div className="h-2 flex-1 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-amber-400" style={{ width: `${ratingTotal ? (n / ratingTotal) * 100 : 0}%` }} />
                      </div>
                      <span className="w-8 text-right text-slate-500">{n}</span>
                    </div>
                  );
                })}
              </div>
              {s.rating.tags.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Khách nhận xét</div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.rating.tags.map(t => (
                      <span key={t.tag} className={clsx('rounded-full px-2.5 py-1 text-xs', RATING_TAG[t.tag]?.positive === false ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
                        {RATING_TAG[t.tag]?.label ?? t.tag} · {t.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Đánh giá gần đây" padded={false}>
              {s.rating.recent.length === 0 ? (
                <EmptyState title="Chưa có đánh giá" description="Khách có thể chấm sao sau khi chuyến kết thúc." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {s.rating.recent.map((r, i) => (
                    <li key={i} className="px-5 py-3">
                      <div className="flex items-center justify-between">
                        <span className="flex">
                          {[1, 2, 3, 4, 5].map(x => (
                            <Star key={x} className={clsx('h-4 w-4', x <= r.stars ? 'fill-amber-400 text-amber-400' : 'text-slate-200')} />
                          ))}
                        </span>
                        <span className="text-xs text-slate-400">{time(r.createdAt)}</span>
                      </div>
                      {r.comment && <p className="mt-1 text-sm text-slate-700">“{r.comment}”</p>}
                      {r.tags.length > 0 && <p className="mt-1 text-xs text-slate-500">{r.tags.map(t => RATING_TAG[t]?.label ?? t).join(' · ')}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Mục tiêu: nhận ≥ 80% cuốc được giao, hủy ≤ 5% chuyến đã nhận. Báo &quot;khách không xuất hiện&quot; sau khi chờ đủ 2 phút vẫn được tính là hủy; nếu khách cố tình bom chuyến, hãy gửi phản ánh ở{' '}
            <Link href="/tai-xe/tro-giup?category=PASSENGER_NO_SHOW" className="text-brand-600 hover:underline">
              Trung tâm trợ giúp
            </Link>
            .
          </p>
        </>
      )}
    </Container>
  );
}
