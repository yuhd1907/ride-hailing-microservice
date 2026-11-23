'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '@/lib/client';

const inputClass = 'h-11 w-full rounded-xl border border-slate-300 px-3.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100';

export default function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ fullName, phone });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = form.fullName !== fullName || form.phone !== phone;

  return (
    <form
      className="space-y-4"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        const r = await call('/users/me', { method: 'PUT', body: form });
        setBusy(false);
        setMessage(r.ok ? { ok: true, text: 'Đã lưu thay đổi.' } : { ok: false, text: r.error ?? 'Không lưu được.' });
        if (r.ok) router.refresh();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Họ và tên</span>
          <input className={inputClass} value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} required minLength={2} maxLength={100} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Số điện thoại</span>
          <input className={inputClass} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} required pattern="0\d{9}" title="10 chữ số, bắt đầu bằng 0" />
        </label>
      </div>
      {message && <div className={`rounded-xl px-4 py-3 text-sm ${message.ok ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>{message.text}</div>}
      <button type="submit" disabled={busy || !changed} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Lưu thay đổi
      </button>
    </form>
  );
}
