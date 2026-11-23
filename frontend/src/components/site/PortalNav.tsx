'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function PortalNav({ items }: { items: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
      {items.map(item => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
