'use client';

import clsx from 'clsx';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { call } from '@/lib/client';
import { time, vnd } from '@/lib/format';
import { BANK_TX } from '@/lib/labels';
import type { BankAccount, BankTransaction, WalletPolicy } from '@/lib/types';
import { EmptyState, Panel } from './Blocks';

/** Ví tài xế: nhận tiền chuyến trả bằng tài khoản (sau chiết khấu), bị trừ chiết khấu chuyến tiền mặt, nạp và rút tiền. */
export default function DriverWallet({ initialAccount, initialTransactions, policy }: { initialAccount: BankAccount | null; initialTransactions: BankTransaction[]; policy: WalletPolicy | null }) {
  const [account, setAccount] = useState(initialAccount);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [mode, setMode] = useState<'withdraw' | 'topup'>('withdraw');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [a, t] = await Promise.all([call<BankAccount>('/payments/bank/me'), call<BankTransaction[]>('/payments/bank/me/transactions?limit=50')]);
    if (a.ok) setAccount(a.data);
    if (t.ok && t.data) setTransactions(t.data);
  }, []);

  const available = Number(account?.available ?? 0);
  const minWithdraw = Number(policy?.minWithdraw ?? 50000);
  const value = Number(amount.replace(/\D/g, ''));
  const rate = policy ? Number(policy.commissionRate) : null;

  async function submit(target: number) {
    if (!target) return;
    setBusy(true);
    setMessage(null);
    const r = await call<BankAccount>(mode === 'withdraw' ? '/payments/bank/me/withdraw' : '/payments/bank/me/topup', { body: { amount: target } });
    setBusy(false);
    if (!r.ok) return setMessage({ ok: false, text: r.error ?? 'Không thực hiện được giao dịch.' });
    setAccount(r.data);
    setAmount('');
    setMessage({ ok: true, text: mode === 'withdraw' ? `Đã chuyển ${vnd(target)} về tài khoản ngân hàng liên kết.` : `Đã nạp ${vnd(target)} vào ví.` });
    await reload();
  }

  const quick = mode === 'withdraw' ? [minWithdraw, 100000, 200000, Math.floor(available / 1000) * 1000].filter((v, i, all) => v >= minWithdraw && v <= available && all.indexOf(v) === i) : [50000, 100000, 200000, 500000];
  const negative = Number(account?.balance ?? 0) < 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <section className={clsx('rounded-2xl p-6 text-white shadow-sm', negative ? 'bg-gradient-to-br from-red-600 to-rose-700' : 'bg-gradient-to-br from-brand-600 to-brand-800')}>
          <div className="flex items-center gap-2 text-sm text-white/80">
            <Wallet className="h-4 w-4" /> Số dư ví
          </div>
          <div className="mt-2 text-3xl font-bold">{account ? vnd(account.balance) : '—'}</div>
          <div className="mt-3 flex justify-between text-sm text-white/80">
            <span>Khả dụng để rút</span>
            <span className="font-semibold text-white">{account ? vnd(Math.max(0, available)) : '—'}</span>
          </div>
          {negative && <p className="mt-3 rounded-lg bg-white/15 px-3 py-2 text-xs">Ví âm do chiết khấu các chuyến tiền mặt. Nạp tiền để tất toán khoản nợ với nền tảng.</p>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
            {(['withdraw', 'topup'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setMessage(null);
                }}
                className={clsx('flex items-center justify-center gap-1.5 rounded-lg py-2 transition', mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              >
                {m === 'withdraw' ? <ArrowUpFromLine className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}
                {m === 'withdraw' ? 'Rút tiền' : 'Nạp tiền'}
              </button>
            ))}
          </div>
          <label className="mt-4 block text-xs font-medium text-slate-500" htmlFor="wallet-amount">
            Số tiền (VND)
          </label>
          <input
            id="wallet-amount"
            inputMode="numeric"
            value={value ? new Intl.NumberFormat('vi-VN').format(value) : ''}
            onChange={e => setAmount(e.target.value)}
            placeholder={mode === 'withdraw' ? `Tối thiểu ${vnd(minWithdraw)}` : 'Từ 1.000 đến 5.000.000'}
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {quick.map(v => (
              <button key={v} type="button" onClick={() => setAmount(String(v))} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                {v === available && mode === 'withdraw' ? `Tất cả (${vnd(v)})` : vnd(v)}
              </button>
            ))}
          </div>
          {mode === 'withdraw' && available < minWithdraw && <p className="mt-2 text-xs text-slate-500">Cần tối thiểu {vnd(minWithdraw)} khả dụng để rút.</p>}
          <button
            type="button"
            onClick={() => void submit(value)}
            disabled={busy || !value || (mode === 'withdraw' && (value < minWithdraw || value > available))}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'withdraw' ? `Rút ${value ? vnd(value) : ''} về ngân hàng` : `Nạp ${value ? vnd(value) : ''} vào ví`}
          </button>
          {message && <p className={clsx('mt-3 text-sm', message.ok ? 'text-emerald-700' : 'text-red-600')}>{message.text}</p>}
        </section>

        {rate !== null && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
            <div className="font-semibold text-slate-900">Cách ví được cộng / trừ</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Khách trả bằng tài khoản: ví nhận <strong>{Math.round((1 - rate) * 100)}%</strong> cước ngay khi thanh toán xong.
              </li>
              <li>
                Khách trả tiền mặt: bạn giữ toàn bộ tiền mặt, ví bị trừ <strong>{Math.round(rate * 100)}%</strong> chiết khấu nền tảng.
              </li>
              <li>
                Rút tối thiểu {vnd(policy?.minWithdraw)}, tối đa {vnd(policy?.maxWithdraw)} mỗi lần.
              </li>
            </ul>
            <Link href="/tai-xe/thu-nhap" className="mt-3 inline-block font-medium text-brand-600 hover:underline">
              Xem báo cáo thu nhập
            </Link>
          </section>
        )}
      </div>

      <Panel title="Lịch sử giao dịch ví" padded={false}>
        {transactions.length === 0 ? (
          <EmptyState title="Chưa có giao dịch" description="Thu nhập từ các chuyến và các lần nạp / rút tiền sẽ hiện ở đây." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {transactions.map(tx => {
              const meta = BANK_TX[tx.type] ?? { label: tx.type, sign: 0 };
              return (
                <li key={tx.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800">{meta.label}</div>
                    <div className="text-xs text-slate-400">
                      {time(tx.createdAt)}
                      {tx.tripId && (
                        <>
                          {' · '}
                          <Link href={`/tai-xe/chuyen-di/${tx.tripId}`} className="font-mono text-brand-600 hover:underline">
                            {tx.tripId.slice(0, 8).toUpperCase()}
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={clsx('font-semibold', meta.sign > 0 ? 'text-emerald-600' : meta.sign < 0 ? 'text-red-600' : 'text-slate-600')}>
                      {meta.sign > 0 ? '+' : meta.sign < 0 ? '−' : ''}
                      {vnd(tx.amount)}
                    </div>
                    <div className="text-xs text-slate-400">Số dư {vnd(tx.balanceAfter)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
