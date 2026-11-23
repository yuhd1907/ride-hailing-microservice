import clsx from 'clsx';
import Link from 'next/link';

export const TRIP_FILTERS = [
  { key: '', label: 'Tất cả' },
  { key: 'CONFIRMED', label: 'Hoàn thành' },
  { key: 'IN_PROGRESS', label: 'Đang đi' },
  { key: 'CANCELLED', label: 'Đã hủy' },
  { key: 'FAILED', label: 'Không thành công' },
];

export default function StatusTabs({ base, active }: { base: string; active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-2">
      {TRIP_FILTERS.map(f => (
        <Link
          key={f.key}
          href={f.key ? `${base}?trang-thai=${f.key}` : base}
          className={clsx(
            'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium',
            active === f.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {f.label}
        </Link>
      ))}
    </div>
  );
}
