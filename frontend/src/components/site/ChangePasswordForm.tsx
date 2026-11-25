'use client';

import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { call } from '@/lib/client';

// Cùng quy tắc với lúc đăng ký (User Service kiểm tra lại).
const RULES: { test: (v: string) => boolean; label: string }[] = [
  { test: v => v.length >= 8 && v.length <= 32, label: '8-32 ký tự' },
  { test: v => /[a-z]/.test(v), label: '1 chữ thường' },
  { test: v => /[A-Z]/.test(v), label: '1 chữ hoa' },
  { test: v => /\d/.test(v), label: '1 chữ số' },
  { test: v => /[@$!%*?&]/.test(v), label: '1 ký tự đặc biệt @$!%*?&' },
  { test: v => /^[A-Za-z\d@$!%*?&]*$/.test(v), label: 'không dấu cách / ký tự khác' },
];

/** Đổi mật khẩu: PUT /users/me/password (cần mật khẩu hiện tại). */
export default function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const valid = RULES.every(r => r.test(next)) && next === confirm && current.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setMessage(null);
    const r = await call('/users/me/password', { method: 'PUT', body: { currentPassword: current, newPassword: next } });
    setBusy(false);
    if (!r.ok) return setMessage({ ok: false, text: r.error ?? 'Không đổi được mật khẩu.' });
    setCurrent('');
    setNext('');
    setConfirm('');
    setMessage({ ok: true, text: 'Đã đổi mật khẩu. Lần đăng nhập sau dùng mật khẩu mới.' });
  }

  const input = 'h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100';
  return (
    <form onSubmit={e => void submit(e)} className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Mật khẩu hiện tại</span>
        <input type={show ? 'text' : 'password'} value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" className={`mt-1 ${input}`} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Mật khẩu mới</span>
        <input type={show ? 'text' : 'password'} value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" className={`mt-1 ${input}`} />
      </label>
      {next && (
        <ul className="flex flex-wrap gap-1.5 text-[11px]">
          {RULES.map(r => (
            <li key={r.label} className={r.test(next) ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700' : 'rounded-full bg-slate-100 px-2 py-0.5 text-slate-500'}>
              {r.test(next) ? '✓ ' : ''}
              {r.label}
            </li>
          ))}
        </ul>
      )}
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Nhập lại mật khẩu mới</span>
        <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" className={`mt-1 ${input}`} />
        {confirm && confirm !== next && <span className="mt-1 block text-xs text-red-600">Mật khẩu nhập lại chưa khớp.</span>}
      </label>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setShow(v => !v)} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        </button>
        <button type="submit" disabled={!valid || busy} className="flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Đổi mật khẩu
        </button>
      </div>
      {message && <p className={message.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-600'}>{message.text}</p>}
    </form>
  );
}
