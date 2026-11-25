import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, EmptyState, ErrorState, PageTitle, Panel, Stat } from '@/components/site/Blocks';
import Pill from '@/components/site/Pill';
import { time, vnd } from '@/lib/format';
import { FAILURE_REASON, PAYMENT_METHOD, PAYMENT_STATUS } from '@/lib/labels';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { BankAccount, Payment } from '@/lib/types';

export const metadata: Metadata = { title: 'Thanh toán' };

export default async function PassengerPayments() {
  requireUser('ROLE_PASSENGER');
  const [payments, bank] = await Promise.all([gateway<Payment[]>('/payments/me?limit=100'), gateway<BankAccount>('/payments/bank/me')]);
  const list = [...(payments.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const paid = list.filter(p => p.status === 'SUCCESS');
  const total = paid.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <Container>
      <PageTitle title="Thanh toán" subtitle="Lịch sử giao dịch của các chuyến đi" />
      {payments.error && <ErrorState message={payments.error} />}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Số dư khả dụng" value={bank.data ? vnd(bank.data.available) : '—'} hint={bank.data && Number(bank.data.held) > 0 ? `Đang tạm giữ ${vnd(bank.data.held)}` : 'Tài khoản RideFlow'} />
        <Stat label="Tổng đã chi" value={vnd(total)} />
        <Stat label="Giao dịch thành công" value={paid.length} />
        <Stat label="Giao dịch thất bại" value={list.filter(p => p.status === 'FAILED').length} />
      </div>
      <Panel title="Giao dịch" padded={false}>
        {list.length === 0 ? (
          <EmptyState title="Chưa có giao dịch" description="Chuyến thanh toán ngân hàng được trừ tiền tự động khi kết thúc; chuyến tiền mặt hoàn tất khi tài xế xác nhận đã nhận tiền." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Thời gian</th>
                  <th className="px-5 py-3 font-medium">Mã giao dịch</th>
                  <th className="px-5 py-3 font-medium">Chuyến</th>
                  <th className="px-5 py-3 font-medium">Phương thức</th>
                  <th className="px-5 py-3 text-right font-medium">Số tiền</th>
                  <th className="px-5 py-3 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map(p => {
                  const s = PAYMENT_STATUS[p.status] ?? { label: p.status, tone: 'gray' as const };
                  return (
                    <tr key={p.paymentId}>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-500">{time(p.createdAt)}</td>
                      <td className="px-5 py-3 font-mono text-xs">{p.paymentId.slice(0, 8).toUpperCase()}</td>
                      <td className="px-5 py-3">
                        <Link href={`/khach-hang/chuyen-di/${p.tripId}`} className="font-mono text-xs text-brand-600 hover:underline">
                          {p.tripId.slice(0, 8).toUpperCase()}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{p.method ? PAYMENT_METHOD[p.method] ?? p.method : '—'}</td>
                      <td className="px-5 py-3 text-right font-semibold">{vnd(p.amount)}</td>
                      <td className="px-5 py-3">
                        <Pill tone={s.tone}>{s.label}</Pill>
                        {p.failureReason && <div className="mt-1 text-xs text-red-600">{FAILURE_REASON[p.failureReason] ?? p.failureReason}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Container>
  );
}
