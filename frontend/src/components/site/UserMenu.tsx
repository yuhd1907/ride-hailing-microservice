'use client';

import { ChevronDown, LogOut, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { logout } from '@/lib/client';

export default function UserMenu({ name, email, roleLabel }: { name: string; email: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map(w => w[0]?.toUpperCase())
    .join('');

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-full border border-white/20 py-1 pl-1 pr-3 hover:bg-white/10"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-bold text-black">{initials || 'U'}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium text-white">{name}</span>
          <span className="block text-[11px] text-neutral-400">{roleLabel}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-neutral-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-[1100] mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="truncate text-sm font-medium text-slate-900">{name}</div>
            <div className="truncate text-xs text-slate-500">{email}</div>
          </div>
          <Link href="/tai-khoan" className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setOpen(false)}>
            <UserCog className="h-4 w-4" /> Tài khoản của tôi
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await logout();
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" /> {busy ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </button>
        </div>
      )}
    </div>
  );
}
