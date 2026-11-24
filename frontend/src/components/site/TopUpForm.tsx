'use client';

import clsx from 'clsx';
import { Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '@/lib/client';
import { vnd } from '@/lib/format';
import type { BankAccount } from '@/lib/types';

const QUICK = [50000, 100000, 200000, 500000];
const MIN = 1000;
const MAX = 5000000;

/** Nạp tiền vào ngân hàng ảo: POST /payments/bank/me/topup, 1.000 đến 5.000.000 đ mỗi lần. */
export default function TopUpForm() {
  const router = useRouter();
  const [amount, setAmount] = useState('100000');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const value = Number(amount);
  const valid = Number.isFinite(value) && value >= MIN && value <= MAX;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setMessage(null);
    const r = await call<BankAccount>('/payments/bank/me/topup', {
      body: { amount: value },
    });
    setBusy(false);
    setMessage(
      r.ok && r.data
        ? {
            ok: true,
            text: `Đã nạp ${vnd(value)}. Khả dụng: ${vnd(r.data.available)}.`,
          }
        : { ok: false, text: r.error ?? 'Nạp tiền không thành công.' },
    );
    if (r.ok) router.refresh();
  }

  return (
    <form onSubmit={e => void submit(e)} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {QUICK.map(q => (
          <button
            key={q}
            type="button"
            onClick={() => setAmount(String(q))}
            className={clsx(
              'rounded-xl border px-3 py-2 text-sm font-semibold transition',
              value === q ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50',
            )}
          >
            {vnd(q)}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="text-sm text-slate-600">Số tiền khác (VND)</span>
        <input
          type="number"
          inputMode="numeric"
          min={MIN}
          max={MAX}
          step={1000}
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        <span className="mt-1 block text-xs text-slate-400">
          Từ {vnd(MIN)} đến {vnd(MAX)} mỗi lần.
        </span>
      </label>
      {message && <div className={clsx('rounded-xl px-4 py-3 text-sm', message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>{message.text}</div>}
      <button
        type="submit"
        disabled={!valid || busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Nạp {valid ? vnd(value) : 'tiền'}
      </button>
    </form>
  );
}
