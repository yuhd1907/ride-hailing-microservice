'use client';

import clsx from 'clsx';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  ChevronDown,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Loader2,
  Navigation,
  RotateCw,
  Ship,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cumulativeMeters, decodePolyline, nearestOnPath } from '@/lib/polyline';
import { formatDistance, formatDuration, useRoute, type NavStep } from '@/lib/routes';
import type { Point, VehicleType } from '@/lib/types';

/** Lệch khỏi lộ trình quá ngưỡng này thì tính lại đường từ vị trí hiện tại. */
const OFF_ROUTE_METERS = 60;
/** Tính lại đường tối đa mỗi 15 giây (mỗi lần tốn một lượt gọi Routes API). */
const REROUTE_INTERVAL_MS = 15000;

const ICONS: Record<string, LucideIcon> = {
  TURN_LEFT: CornerUpLeft,
  TURN_SHARP_LEFT: CornerUpLeft,
  TURN_RIGHT: CornerUpRight,
  TURN_SHARP_RIGHT: CornerUpRight,
  TURN_SLIGHT_LEFT: ArrowUpLeft,
  RAMP_LEFT: ArrowUpLeft,
  FORK_LEFT: ArrowUpLeft,
  TURN_SLIGHT_RIGHT: ArrowUpRight,
  RAMP_RIGHT: ArrowUpRight,
  FORK_RIGHT: ArrowUpRight,
  UTURN_LEFT: Undo2,
  UTURN_RIGHT: Undo2,
  ROUNDABOUT_LEFT: RotateCw,
  ROUNDABOUT_RIGHT: RotateCw,
  FERRY: Ship,
  FERRY_TRAIN: Ship,
};

export function ManeuverIcon({ maneuver, className }: { maneuver: string; className?: string }) {
  const Icon = ICONS[maneuver] ?? ArrowUp;
  return <Icon className={className} />;
}

/** Vài điểm nằm phía trước trên tuyến khách chọn, để Google dẫn đường bám theo đúng tuyến đó. */
function viaPoints(preferred: string | null | undefined, from: Point | null): Point[] {
  if (!preferred || !from) return [];
  const path = decodePolyline(preferred);
  if (path.length < 2) return [];
  const start = nearestOnPath(path, from).index;
  const ahead = path.slice(start);
  const cum = cumulativeMeters(ahead);
  const total = cum[cum.length - 1];
  if (total < 800) return [];
  return [0.2, 0.45, 0.7].map(f => ahead[cum.findIndex(m => m >= total * f)]).filter(Boolean);
}

/**
 * Dẫn đường từng bước cho tài xế. Lộ trình được lấy một lần từ vị trí hiện tại; sau đó chỉ so GPS với lộ trình
 * để biết bước tiếp theo và quãng đường còn lại, chỉ gọi lại Routes API khi tài xế đi lệch tuyến.
 */
export function useTurnByTurn({
  active,
  fix,
  target,
  vehicleType,
  preferred,
}: {
  active: boolean;
  fix: Point | null;
  target: Point;
  vehicleType?: VehicleType | null;
  /** Tuyến khách chọn (khi đã đón khách). */
  preferred?: string | null;
}) {
  const [anchor, setAnchor] = useState<Point | null>(null);
  const targetKey = `${target.lat},${target.lng}`;
  const anchoredTarget = useRef('');
  const lastReroute = useRef(0);
  const hasFix = !!fix;

  // Lấy đường mới khi bắt đầu dẫn đường hoặc khi đổi đích (đã đón khách → chuyển sang điểm đến).
  useEffect(() => {
    if (!active) {
      setAnchor(null);
      anchoredTarget.current = '';
      return;
    }
    if (fix && anchoredTarget.current !== targetKey) {
      anchoredTarget.current = targetKey;
      lastReroute.current = Date.now();
      setAnchor(fix);
    }
  }, [active, hasFix, targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const via = useMemo(() => viaPoints(preferred, anchor), [preferred, anchor]);
  const { route, loading } = useRoute(active ? anchor : null, active ? target : null, { vehicleType, steps: true, via });
  const path = useMemo(() => (route ? decodePolyline(route.encodedPath) : []), [route]);
  const cum = useMemo(() => cumulativeMeters(path), [path]);
  // Điểm bắt đầu của từng bước trên lộ trình (tăng dần).
  const stepAt = useMemo(() => {
    let from = 0;
    return (route?.steps ?? []).map(s => (from = path.length ? nearestOnPath(path, s.start, from).index : 0));
  }, [route, path]);

  const near = fix && path.length ? nearestOnPath(path, fix) : null;

  // Đi lệch tuyến: tính lại đường từ vị trí hiện tại (giới hạn tần suất để tiết kiệm lượt gọi API).
  useEffect(() => {
    if (!active || !fix || !near || near.meters <= OFF_ROUTE_METERS) return;
    if (Date.now() - lastReroute.current < REROUTE_INTERVAL_MS) return;
    lastReroute.current = Date.now();
    setAnchor(fix);
  }, [active, fix?.lat, fix?.lng, near?.meters]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = route?.steps ?? [];
  const here = near?.index ?? 0;
  // Bước hiện tại: bước cuối cùng mà tài xế đã đi qua điểm bắt đầu của nó.
  let current = 0;
  for (let k = 0; k < stepAt.length; k++) if (stepAt[k] <= here) current = k;
  const next: NavStep | null = steps[current + 1] ?? null;
  const total = cum[cum.length - 1] ?? 0;
  const remainingMeters = route ? Math.max(0, total - (cum[here] ?? 0)) : null;

  return {
    route,
    loading: loading || (active && !route && hasFix),
    next,
    nextDistance: next ? Math.max(0, (cum[stepAt[current + 1]] ?? 0) - (cum[here] ?? 0)) : null,
    upcoming: steps.slice(current + 2),
    remainingMeters,
    remainingSeconds: route && remainingMeters !== null && total > 0 ? (route.durationSeconds * remainingMeters) / total : null,
    followingPreferred: via.length > 0,
    offRoute: !!near && near.meters > OFF_ROUTE_METERS,
  };
}

export type TurnByTurn = ReturnType<typeof useTurnByTurn>;

export function NavigationPanel({
  nav,
  toPickup,
  targetName,
  mapsHref,
  waitingForGps,
  gpsProblem,
}: {
  nav: TurnByTurn;
  toPickup: boolean;
  targetName: string;
  mapsHref: string;
  waitingForGps: boolean;
  gpsProblem: string | null;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const arriving = nav.remainingMeters !== null && nav.remainingMeters < 40;
  return (
    <section className="overflow-hidden rounded-2xl bg-black text-white shadow-sm">
      <div className="flex items-start gap-4 p-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/10">
          {waitingForGps || (nav.loading && !nav.route) ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : arriving || !nav.next ? (
            <Flag className="h-7 w-7" />
          ) : (
            <ManeuverIcon maneuver={nav.next.maneuver} className="h-8 w-8" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {waitingForGps ? (
            <div className="text-lg font-semibold">Đang chờ tín hiệu GPS…</div>
          ) : !nav.route ? (
            <div className="text-lg font-semibold">{nav.loading ? 'Đang tính đường đi…' : 'Chưa tính được đường đi'}</div>
          ) : arriving || !nav.next ? (
            <>
              <div className="text-2xl font-bold">{arriving ? 'Đã đến nơi' : `Còn ${formatDistance(nav.remainingMeters ?? 0)}`}</div>
              <div className="text-sm text-neutral-300">{toPickup ? 'Điểm đón ở phía trước' : 'Điểm trả khách ở phía trước'}</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold">Sau {formatDistance(nav.nextDistance ?? 0)}</div>
              <div className="text-base leading-snug">{nav.next.instruction || 'Đi tiếp'}</div>
              {nav.next.notes.length > 0 && <div className="mt-0.5 text-xs text-neutral-400">{nav.next.notes.join(' · ')}</div>}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-sm">
        <div className="min-w-0">
          <div className="truncate text-neutral-300">
            {toPickup ? 'Tới điểm đón' : 'Tới điểm trả khách'}: <span className="text-white">{targetName}</span>
          </div>
          {nav.remainingMeters !== null && (
            <div className="font-semibold">
              Còn {formatDistance(nav.remainingMeters)}
              {nav.remainingSeconds !== null && ` · khoảng ${formatDuration(nav.remainingSeconds)}`}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
            {nav.followingPreferred && <span className="rounded-full bg-white/15 px-2 py-0.5">Theo tuyến khách chọn</span>}
            {nav.offRoute && <span className="rounded-full bg-amber-500/90 px-2 py-0.5 text-black">Đang tính lại đường</span>}
          </div>
          {gpsProblem && <div className="mt-1 text-xs text-amber-300">{gpsProblem}</div>}
        </div>
        <a href={mapsHref} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-neutral-200">
          <Navigation className="h-4 w-4" /> Mở Google Maps
        </a>
      </div>

      {nav.upcoming.length > 0 && (
        <div className="border-t border-white/10">
          <button type="button" onClick={() => setShowSteps(s => !s)} aria-expanded={showSteps} className="flex w-full items-center justify-between px-4 py-3 text-sm text-neutral-300 hover:text-white">
            Các bước tiếp theo ({nav.upcoming.length})
            <ChevronDown className={clsx('h-4 w-4 transition-transform duration-300', showSteps && 'rotate-180')} />
          </button>
          <div className={clsx('grid transition-all duration-300', showSteps ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]')}>
            <ol className="min-h-0 overflow-hidden">
              {nav.upcoming.map((s, i) => (
                <li key={`${i}-${s.start.lat}-${s.start.lng}`} className="flex items-start gap-3 border-t border-white/5 px-4 py-2.5 text-sm">
                  <ManeuverIcon maneuver={s.maneuver} className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                  <span className="min-w-0 flex-1">{s.instruction || 'Đi tiếp'}</span>
                  <span className="shrink-0 text-xs text-neutral-400">{formatDistance(s.distanceMeters)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
