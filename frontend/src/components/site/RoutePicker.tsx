'use client';

import clsx from 'clsx';
import { Loader2, Route as RouteIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDistance, formatDuration, routeBadges, trafficOf, type RouteInfo } from '@/lib/routes';
import Collapsible from './Collapsible';
import { TRAFFIC_COLOR } from './Map';

/** Thanh tỉ lệ đường thông thoáng / chậm / tắc của một tuyến. */
export function TrafficBar({ route, className }: { route: RouteInfo; className?: string }) {
  const t = useMemo(() => trafficOf(route), [route]);
  const part = (meters: number) => `${t.total > 0 ? (meters / t.total) * 100 : 0}%`;
  return (
    <div className={clsx('flex h-1.5 overflow-hidden rounded-full bg-slate-100', className)} aria-hidden>
      <span style={{ width: part(t.NORMAL), background: TRAFFIC_COLOR.NORMAL }} />
      <span style={{ width: part(t.SLOW), background: TRAFFIC_COLOR.SLOW }} />
      <span style={{ width: part(t.TRAFFIC_JAM), background: TRAFFIC_COLOR.TRAFFIC_JAM }} />
    </div>
  );
}

/** Thời gian mất thêm vì kẹt xe so với lúc đường thoáng. */
export function TrafficDelay({ route }: { route: RouteInfo }) {
  const delay = route.durationSeconds - route.staticDurationSeconds;
  const jam = trafficOf(route).TRAFFIC_JAM;
  if (delay < 120) return <span className="text-emerald-700">Đường thông thoáng</span>;
  return (
    <span className="text-amber-700">
      Chậm {formatDuration(delay)} do kẹt xe{jam >= 100 ? ` · tắc ${formatDistance(jam)}` : ''}
    </span>
  );
}

export default function RoutePicker({
  routes,
  selected,
  onSelect,
  loading,
}: {
  routes: RouteInfo[];
  selected: number;
  onSelect: (index: number) => void;
  loading: boolean;
}) {
  const badges = useMemo(() => routeBadges(routes), [routes]);
  // Thanh thu/mở như các mục Loại xe, Thanh toán: mặc định thu gọn, tiêu đề hiện tuyến đang chọn.
  const [open, setOpen] = useState(false);
  if (loading && routes.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang tìm lộ trình…
      </div>
    );
  }
  if (routes.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
        <RouteIcon className="h-5 w-5 shrink-0" /> Không tìm được lộ trình giữa hai điểm này.
      </div>
    );
  }
  const current = routes[selected] ?? routes[0];
  const delayed = current.durationSeconds - current.staticDurationSeconds >= 120;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
      <Collapsible
        title={routes.length > 1 ? `${routes.length} tuyến đường` : 'Lộ trình'}
        icon={<RouteIcon className="h-4 w-4" />}
        open={open}
        onToggle={() => setOpen(o => !o)}
        summary={
          <span className={delayed ? 'text-amber-700' : 'text-slate-700'}>
            <strong className="text-slate-900">{formatDuration(current.durationSeconds)}</strong> · {formatDistance(current.distanceMeters)}
            {badges[routes.indexOf(current)]?.[0] && <span className="text-slate-500"> · {badges[routes.indexOf(current)][0]}</span>}
          </span>
        }
      >
        <div className="mb-2 flex items-center justify-end px-1">
          <span className="flex items-center gap-2 text-[11px] text-slate-500">
            {(['NORMAL', 'SLOW', 'TRAFFIC_JAM'] as const).map(s => (
              <span key={s} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: TRAFFIC_COLOR[s] }} />
                {s === 'NORMAL' ? 'Thoáng' : s === 'SLOW' ? 'Chậm' : 'Tắc'}
              </span>
            ))}
          </span>
        </div>
        <div className="space-y-2" role="radiogroup" aria-label="Tuyến đường">
          {routes.map((r, i) => {
            const active = i === selected;
            return (
              <button
                key={r.encodedPath}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(i)}
                className={clsx(
                  'w-full rounded-xl border p-3 text-left transition',
                  active ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="whitespace-nowrap text-sm">
                    <strong className="text-base text-slate-900">{formatDuration(r.durationSeconds)}</strong>
                    <span className="text-slate-500"> · {formatDistance(r.distanceMeters)}</span>
                  </span>
                  <span className="truncate text-xs">
                    <TrafficDelay route={r} />
                  </span>
                </div>
                {badges[i].length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {badges[i].map(b => (
                      <span
                        key={b}
                        className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', b === 'Đề xuất' ? 'bg-black text-white' : 'bg-slate-100 text-slate-700')}
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                )}
                <TrafficBar route={r} className="mt-2" />
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-slate-500">
          {routes.length > 1 ? 'Bấm một tuyến (hoặc đường xám trên bản đồ) để chọn. ' : ''}Tài xế sẽ được dẫn đường theo tuyến bạn chọn; giá cước không đổi theo tuyến.
        </p>
      </Collapsible>
      {/* Thu gọn: vẫn thấy nhanh tình trạng giao thông của tuyến đang chọn. */}
      {!open && <TrafficBar route={current} className="-mt-1 mb-3.5" />}
    </div>
  );
}
