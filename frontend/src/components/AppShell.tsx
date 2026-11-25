'use client';

import clsx from 'clsx';
import {
  Activity,
  Car,
  CreditCard,
  FlaskConical,
  LayoutDashboard,
  ScrollText,
  UserRound,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { roleLabel } from '@/lib/format';
import { useMounted } from '@/lib/hooks';
import { actions, useActiveSession, useAppState } from '@/lib/store';

const NAV = [
  { group: 'Hệ thống', items: [{ href: '/console', label: 'Tổng quan', icon: LayoutDashboard }] },
  {
    group: 'Nghiệp vụ',
    items: [
      { href: '/console/accounts', label: 'Tài khoản & phiên', icon: Users },
      { href: '/console/passenger', label: 'Hành khách', icon: UserRound },
      { href: '/console/driver', label: 'Tài xế', icon: Car },
      { href: '/console/payments', label: 'Thanh toán & thông báo', icon: CreditCard },
    ],
  },
  {
    group: 'Kiểm thử',
    items: [
      { href: '/console/scenarios', label: 'Kịch bản phân tán', icon: FlaskConical },
      { href: '/console/logs', label: 'Nhật ký request', icon: ScrollText },
    ],
  },
];

function SessionSwitcher() {
  const mounted = useMounted();
  const sessions = useAppState(s => s.sessions);
  const active = useActiveSession();
  if (!mounted) return <div className="h-9 w-64" />;

  if (sessions.length === 0) {
    return (
      <Link href="/console/accounts" className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50">
        Chưa đăng nhập — thêm phiên
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-slate-500 sm:inline">Đang thao tác với</span>
      <select
        value={active?.id ?? ''}
        onChange={e => actions.setActiveSession(e.target.value)}
        className="h-9 max-w-[320px] rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
      >
        {sessions.map(s => (
          <option key={s.id} value={s.id}>
            {s.email} · {roleLabel(s.roles)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const logCount = useAppState(s => s.logs.length);
  const mounted = useMounted();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-slate-900 text-slate-300 lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-slate-800 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-brand-600 text-white">
            <Activity className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Gogo Console</div>
            <div className="text-[11px] text-slate-400">Kiểm thử microservice</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV.map(section => (
            <div key={section.group} className="mb-5">
              <div className="mb-1.5 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{section.group}</div>
              {section.items.map(item => {
                const active = item.href === '/console' ? pathname === '/console' : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      'mb-0.5 flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
                      active ? 'bg-slate-800 font-medium text-white' : 'hover:bg-slate-800/60 hover:text-white',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="flex-1">{item.label}</span>
                    {item.href === '/console/logs' && mounted && logCount > 0 && (
                      <span className="rounded bg-slate-700 px-1.5 text-[10px] text-slate-200">{logCount}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-5 py-3 text-[11px] text-slate-500">Mọi request đi qua API Gateway</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-6 backdrop-blur">
          <nav className="flex gap-1 overflow-x-auto lg:hidden">
            {NAV.flatMap(s => s.items).map(item => (
              <Link key={item.href} href={item.href} className="whitespace-nowrap rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden text-sm text-slate-500 lg:block">
            Gateway: <span className="font-mono text-slate-700">/gw → GATEWAY_URL</span>
          </div>
          <SessionSwitcher />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
