'use client';

import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

// Mục thu/mở dạng thanh trượt: bấm tiêu đề để mở/thu, nội dung trượt bằng grid-rows 0fr ↔ 1fr.
// Khi thu gọn, nội dung bị ẩn (invisible) nên không nhận focus bằng phím Tab.
export default function Collapsible({
  title,
  icon,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: ReactNode;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-slate-100 first:border-t-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2.5 px-1 py-3.5 text-left">
        <span className="text-slate-400">{icon}</span>
        <span className="shrink-0 text-sm font-semibold text-slate-900">{title}</span>
        <span className="ml-auto min-w-0 truncate text-right text-sm">{summary}</span>
        <ChevronDown className={clsx('h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <div
        className={clsx(
          'grid transition-all duration-300 ease-in-out',
          open ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
        )}
      >
        {/* p-0.5: chừa chỗ cho viền ring của ô đang chọn, không bị overflow cắt mất. */}
        <div className="min-h-0 overflow-hidden">
          <div className="p-0.5 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
