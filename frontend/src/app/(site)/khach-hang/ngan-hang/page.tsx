import clsx from 'clsx';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, EmptyState, ErrorState, PageTitle, Panel, Stat } from '@/components/site/Blocks';
import TopUpForm from '@/components/site/TopUpForm';
import { time, vnd } from '@/lib/format';
import { BANK_TX } from '@/lib/labels';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { BankAccount, BankTransaction } from '@/lib/types';

export const metadata: Metadata = { title: 'Ngân hàng' };

/** Tài khoản ngân hàng ảo của khách (Payment Service): số dư, khoản đang khoá cho chuyến, nạp tiền. */
export default async function PassengerBank() {
  requireUser('ROLE_PASSENGER');
  const [account, transactions] = await Promise.all([gateway<BankAccount>('/payments/bank/me'), gateway<BankTransaction[]>('/payments/bank/me/transactions?limit=50')]);
  const list = transactions.data ?? [];

  return (
    <Container>
      <PageTitle title="Ngân hàng" subtitle="Tài khoản ngân hàng ảo dùng để thanh toán chuyến đi" />
      {(account.error || transactions.error) && (
        <div className="mb-6">
          <ErrorState message={account.error ?? transactions.error ?? ''} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Khả dụng" value={account.data ? vnd(account.data.available) : '—'} hint="Dùng được cho chuyến mới" />
            <Stat label="Đang khoá" value={account.data ? vnd(account.data.held) : '—'} hint="Giữ cho chuyến chưa kết thúc" />
            <Stat label="Số dư" value={account.data ? vnd(account.data.balance) : '—'} />
          </div>
          <Panel title="Giao dịch gần đây" padded={false}>
            {list.length === 0 ? (
              <EmptyState title="Chưa có giao dịch" description="Khi đặt chuyến thanh toán ngân hàng, tiền cước được khoá trước và chỉ bị trừ khi chuyến kết thúc." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3 font-medium">Thời gian</th>
                      <th className="px-5 py-3 font-medium">Loại</th>
                      <th className="px-5 py-3 font-medium">Chuyến</th>
                      <th className="px-5 py-3 text-right font-medium">Số tiền</th>
                      <th className="px-5 py-3 text-right font-medium">Khả dụng sau</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {list.map(tx => {
                      const kind = BANK_TX[tx.type] ?? {
                        label: tx.type,
                        sign: 0,
                      };
                      return (
                        <tr key={tx.id}>
                          <td className="whitespace-nowrap px-5 py-3 text-slate-500">{time(tx.createdAt)}</td>
                          <td className="px-5 py-3">{kind.label}</td>
                          <td className="px-5 py-3">
                            {tx.tripId ? (
                              <Link href={`/khach-hang/chuyen-di/${tx.tripId}`} className="font-mono text-xs text-brand-600 hover:underline">
                                {tx.tripId.slice(0, 8).toUpperCase()}
                              </Link>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td
                            className={clsx(
                              'whitespace-nowrap px-5 py-3 text-right font-semibold',
                              kind.sign > 0 && 'text-emerald-700',
                              kind.sign < 0 && 'text-rose-700',
                              kind.sign === 0 && 'text-slate-600',
                            )}
                          >
                            {kind.sign > 0 ? '+' : kind.sign < 0 ? '−' : ''}
                            {vnd(tx.amount)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-slate-500">{vnd(tx.availableAfter)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
        <Panel title="Nạp tiền">
          <TopUpForm />
        </Panel>
      </div>
    </Container>
  );
}
