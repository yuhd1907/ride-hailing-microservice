'use client';

import clsx from 'clsx';
import { Car, Eye, EyeOff, Loader2, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';

type Role = 'ROLE_PASSENGER' | 'ROLE_DRIVER';

const inputClass =
  'h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100';

function safeNext(next: string | undefined) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export default function AuthForm({ mode, next, defaultRole = 'ROLE_PASSENGER' }: { mode: 'login' | 'register'; next?: string; defaultRole?: Role }) {
  const [form, setForm] = useState({ email: '', password: '', fullName: '', phone: '', role: defaultRole });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mode === 'login' ? { email: form.email, password: form.password } : form),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as { error?: string; redirectTo?: string } | null;
    if (!response?.ok) {
      setError(data?.error ?? 'Không kết nối được máy chủ, vui lòng thử lại.');
      setBusy(false);
      return;
    }
    // Tài xế mới đăng ký cần khai báo phương tiện trước khi nhận cuốc.
    const target = mode === 'register' && form.role === 'ROLE_DRIVER' ? '/tai-xe/phuong-tien' : safeNext(next) ?? data?.redirectTo ?? '/';
    window.location.href = target;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === 'register' && (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">Bạn muốn</div>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { role: 'ROLE_PASSENGER', icon: UserRound, title: 'Đi xe', text: 'Đặt xe cho bản thân' },
                { role: 'ROLE_DRIVER', icon: Car, title: 'Lái xe', text: 'Nhận cuốc, kiếm thu nhập' },
              ] as const
            ).map(option => (
              <button
                key={option.role}
                type="button"
                onClick={() => setForm(f => ({ ...f, role: option.role }))}
                className={clsx(
                  'rounded-xl border p-4 text-left transition',
                  form.role === option.role ? 'border-brand-500 bg-brand-50 ring-4 ring-brand-100' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <option.icon className={clsx('h-5 w-5', form.role === option.role ? 'text-brand-600' : 'text-slate-400')} />
                <div className="mt-2 text-sm font-semibold text-slate-900">{option.title}</div>
                <div className="text-xs text-slate-500">{option.text}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'register' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Họ và tên</span>
            <input className={inputClass} value={form.fullName} onChange={set('fullName')} required minLength={2} maxLength={100} autoComplete="name" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Số điện thoại</span>
            <input className={inputClass} value={form.phone} onChange={set('phone')} required pattern="0\d{9}" title="10 chữ số, bắt đầu bằng 0" inputMode="tel" autoComplete="tel" placeholder="0901234567" />
          </label>
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
        <input className={inputClass} type="email" value={form.email} onChange={set('email')} required autoComplete="email" placeholder="ban@email.com" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Mật khẩu</span>
        <div className="relative">
          <input
            className={clsx(inputClass, 'pr-11')}
            type={show ? 'text' : 'password'}
            value={form.password}
            onChange={set('password')}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
          />
          <button type="button" onClick={() => setShow(s => !s)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600" aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {mode === 'register' && <span className="mt-1 block text-xs text-slate-500">8–32 ký tự, gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt (@$!%*?&).</span>}
      </label>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <button type="submit" disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
      </button>
    </form>
  );
}
