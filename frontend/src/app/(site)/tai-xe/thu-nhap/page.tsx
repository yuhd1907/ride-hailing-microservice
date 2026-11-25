import clsx from 'clsx';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, EmptyState, ErrorState, PageTitle, Panel, Stat } from '@/components/site/Blocks';
import { vnd } from '@/lib/format';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { BankTransaction, Trip, WalletPolicy } from '@/lib/types';

export const metadata: Metadata = { title: 'Thu nhập' };

const PERIODS = { 'hom-nay': 'Hôm nay', '7-ngay': '7 ngày', '30-ngay': '30 ngày', 'tat-ca': 'Tất cả' } as const;
const GROUPS = { ngay: 'Theo ngày', tuan: 'Theo tuần', thang: 'Theo tháng' } as const;
type Period = keyof typeof PERIODS;
type Group = keyof typeof GROUPS;

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function weekKey(d: Date) {
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(monday);
}
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

function periodStart(period: Period) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === 'hom-nay') return d.getTime();
  if (period === '7-ngay') return d.getTime() - 6 * 86400000;
  if (period === '30-ngay') return d.getTime() - 29 * 86400000;
  return 0;
}

function groupLabel(group: Group, key: string) {
  if (group === 'thang') {
    const [y, m] = key.split('-');
    return `Tháng ${Number(m)}/${y}`;
  }
  const d = new Date(`${key}T00:00:00`);
  if (group === 'tuan') {
    const end = new Date(d.getTime() + 6 * 86400000);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} – ${pad(end.getDate())}/${pad(end.getMonth() + 1)}/${end.getFullYear()}`;
  }
  return d.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface Row {
  count: number;
  gross: number;
  cash: number;
  bank: number;
  fee: number;
  net: number;
  distance: number;
}
const empty = (): Row => ({ count: 0, gross: 0, cash: 0, bank: 0, fee: 0, net: 0, distance: 0 });

export default async function DriverEarnings({ searchParams }: { searchParams: { ky?: string; nhom?: string } }) {
  requireUser('ROLE_DRIVER');
  const period: Period = (searchParams.ky as Period) in PERIODS ? (searchParams.ky as Period) : '7-ngay';
  const group: Group = (searchParams.nhom as Group) in GROUPS ? (searchParams.nhom as Group) : 'ngay';
  // Thu nhập = các chuyến đã thanh toán thành công (CONFIRMED trong trip_db); phí nền tảng lấy từ ví (payment_db).
  const [trips, txs, policy] = await Promise.all([
    gateway<Trip[]>('/trips/me?status=CONFIRMED&limit=100'),
    gateway<BankTransaction[]>('/payments/bank/me/transactions?limit=100'),
    gateway<WalletPolicy>('/payments/bank/policy'),
  ]);
  const rate = Number(policy.data?.commissionRate ?? 0.2);
  const settlement = new Map<string, BankTransaction>();
  for (const tx of txs.data ?? []) if (tx.tripId && (tx.type === 'EARNING' || tx.type === 'COMMISSION')) settlement.set(tx.tripId, tx);

  let estimated = 0;
  const since = periodStart(period);
  const done = (trips.data ?? []).filter(t => new Date(t.updatedAt).getTime() >= since);
  const total = empty();
  const groups = new Map<string, Row>();
  for (const t of done) {
    const gross = Number(t.fare);
    const tx = settlement.get(t.tripId);
    // Phí thực tế theo giao dịch ví; chuyến cũ chưa có quyết toán thì ước tính theo tỷ lệ chiết khấu hiện hành.
    const fee = tx ? (tx.type === 'EARNING' ? gross - Number(tx.amount) : Number(tx.amount)) : Math.round(gross * rate);
    if (!tx) estimated += 1;
    const cash = t.paymentMethod === 'CASH';
    const d = new Date(t.updatedAt);
    const key = group === 'thang' ? monthKey(d) : group === 'tuan' ? weekKey(d) : dayKey(d);
    for (const row of [total, groups.get(key) ?? groups.set(key, empty()).get(key)!]) {
      row.count += 1;
      row.gross += gross;
      row.fee += fee;
      row.net += gross - fee;
      row.distance += Number(t.estimatedDistance);
      if (cash) row.cash += gross;
      else row.bank += gross - fee;
    }
  }
  const rows = [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  // Tip khách gửi (vào ví 100%, không tính chiết khấu), trong cùng khoảng thời gian.
  const tips = (txs.data ?? []).filter(tx => tx.type === 'TIP_RECEIVED' && new Date(tx.createdAt).getTime() >= since);
  const tipTotal = tips.reduce((s, tx) => s + Number(tx.amount), 0);
  const max = Math.max(1, ...rows.map(([, r]) => r.net));
  const tab = (active: boolean) => clsx('rounded-lg px-3 py-1.5 text-sm font-medium transition', active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800');

  return (
    <Container>
      <PageTitle
        title="Thu nhập"
        subtitle={`Từ các chuyến đã hoàn thành và thanh toán thành công · chiết khấu nền tảng ${Math.round(rate * 100)}%`}
        actions={
          <Link href="/tai-xe/vi" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Mở ví
          </Link>
        }
      />
      {trips.error && <ErrorState message={trips.error} />}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(Object.keys(PERIODS) as Period[]).map(p => (
            <Link key={p} href={`?ky=${p}&nhom=${group}`} className={tab(p === period)}>
              {PERIODS[p]}
            </Link>
          ))}
        </nav>
        <nav className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(Object.keys(GROUPS) as Group[]).map(g => (
            <Link key={g} href={`?ky=${period}&nhom=${g}`} className={tab(g === group)}>
              {GROUPS[g]}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Thực nhận"
          value={vnd(total.net + tipTotal)}
          hint={`${total.count} chuyến · ${total.distance.toFixed(1)} km${tipTotal > 0 ? ` · gồm ${vnd(tipTotal)} tip (${tips.length} lượt)` : ''}`}
        />
        <Stat label="Tổng cước khách trả" value={vnd(total.gross)} hint={total.count ? `Trung bình ${vnd(Math.round(total.gross / total.count))}/chuyến` : undefined} />
        <Stat label="Phí nền tảng" value={vnd(total.fee)} hint={`${Math.round(rate * 100)}% mỗi chuyến`} />
        <Stat label="Tiền mặt đã thu / vào ví" value={`${vnd(total.cash)}`} hint={`Vào ví ${vnd(total.bank)} (đã trừ phí)`} />
      </div>

      <Panel title={GROUPS[group]} padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="Chưa có thu nhập trong khoảng này" description="Thu nhập được ghi nhận sau khi khách thanh toán thành công." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Kỳ</th>
                  <th className="px-5 py-3 text-right font-medium">Chuyến</th>
                  <th className="px-5 py-3 text-right font-medium">Tổng cước</th>
                  <th className="hidden px-5 py-3 text-right font-medium md:table-cell">Tiền mặt</th>
                  <th className="hidden px-5 py-3 text-right font-medium md:table-cell">Vào ví</th>
                  <th className="px-5 py-3 text-right font-medium">Phí nền tảng</th>
                  <th className="px-5 py-3 font-medium">Thực nhận</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(([key, r]) => (
                  <tr key={key}>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-700">{groupLabel(group, key)}</td>
                    <td className="px-5 py-3 text-right">{r.count}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{vnd(r.gross)}</td>
                    <td className="hidden px-5 py-3 text-right text-slate-500 md:table-cell">{vnd(r.cash)}</td>
                    <td className="hidden px-5 py-3 text-right text-slate-500 md:table-cell">{vnd(r.bank)}</td>
                    <td className="px-5 py-3 text-right text-red-600">−{vnd(r.fee)}</td>
                    <td className="w-1/4 px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-brand-600" style={{ width: `${(r.net / max) * 100}%` }} />
                        </div>
                        <span className="w-28 text-right font-semibold text-slate-900">{vnd(r.net)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-3 text-xs text-slate-400">
        Thực nhận = tổng cước − phí nền tảng. Chuyến tiền mặt: bạn giữ tiền mặt, phí được trừ vào ví. Chuyến trả bằng tài khoản: ví nhận phần sau phí.
        {estimated > 0 && ` ${estimated} chuyến trước khi có ví tài xế được ước tính phí theo tỷ lệ hiện hành.`} Chưa bao gồm thuế.
      </p>
    </Container>
  );
}
