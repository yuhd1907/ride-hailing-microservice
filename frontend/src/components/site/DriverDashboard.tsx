'use client';

import clsx from 'clsx';
import { ArrowRight, Check, Loader2, LocateFixed, MapPin, Power, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/client';
import { vnd } from '@/lib/format';
import { FALLBACK_CENTER, useAddressOf } from '@/lib/geo';
import { coord, DRIVER_STATUS, VEHICLE } from '@/lib/labels';
import { formatDistance, formatDuration, useRoute } from '@/lib/routes';
import { gpsErrorMessage, useDriverTracking } from '@/lib/tracking';
import type { Driver, Point, Trip } from '@/lib/types';
import type { HistoryItem } from './TripTracker';
import Map from './Map';
import Pill from './Pill';

const RESERVATION_SECONDS = 60; // Driver Service tự nhả giữ chỗ sau 60 giây

export default function DriverDashboard({ name, initialDriver, todayTrips, todayEarnings }: { name: string; initialDriver: Driver; todayTrips: number; todayEarnings: number }) {
  const router = useRouter();
  const [driver, setDriver] = useState(initialDriver);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [offeredAt, setOfferedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    const r = await call<Driver>('/drivers/me');
    if (r.ok && r.data) setDriver(r.data);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
      setNow(Date.now());
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Có cuốc (RESERVED / ON_TRIP): tải chuyến và thời điểm cuốc được giao (từ lịch sử trạng thái).
  const tripId = driver.currentTripId;
  useEffect(() => {
    if (!tripId) {
      setTrip(null);
      setOfferedAt(null);
      return;
    }
    void Promise.all([call<Trip>(`/trips/${tripId}`), call<HistoryItem[]>(`/trips/${tripId}/history`)]).then(([t, h]) => {
      if (t.ok) setTrip(t.data);
      const offer = [...(h.data ?? [])].reverse().find(x => x.status === 'AWAITING_DRIVER');
      setOfferedAt(offer ? new Date(offer.createdAt).getTime() : null);
    });
  }, [tripId, driver.status]);

  const sendLocation = useCallback(async (point: Point) => {
    const r = await call('/drivers/me/location', { body: { latitude: point.lat, longitude: point.lng } });
    if (!r.ok) setError(r.error);
    return r.ok;
  }, []);

  // Trực tuyến (AVAILABLE / RESERVED / ON_TRIP) thì theo dõi GPS liên tục; chỉ dừng khi tắt nhận cuốc.
  const online = driver.status !== 'OFFLINE';
  const tracking = useDriverTracking(online, sendLocation);
  const position = tracking.fix;

  async function goOnline() {
    setError(null);
    setBusy('toggle');
    // 1. Lấy vị trí GPS chính xác ngay lúc bật app.
    const fix = await tracking.acquire();
    if (!fix) {
      setBusy(null);
      return setError('Cần vị trí GPS hiện tại để bật nhận cuốc. Hãy cho phép truy cập vị trí rồi thử lại.');
    }
    // 2. Gửi vị trí trước, để khi chuyển sang AVAILABLE tài xế có ngay trong chỉ mục tìm kiếm (Redis GEO).
    if (!(await sendLocation(fix))) return setBusy(null);
    tracking.markSent(fix);
    // 3. Bật nhận cuốc; Matching sẽ ghép với khách đặt xe gần vị trí này.
    const r = await call<Driver>('/drivers/me/go-online', { method: 'POST' });
    if (r.ok && r.data) setDriver(r.data);
    else setError(r.error);
    setBusy(null);
  }

  async function goOffline() {
    setError(null);
    setBusy('toggle');
    // Tắt nhận cuốc: Driver Service xóa vị trí khỏi chỉ mục tìm kiếm, app ngừng theo dõi GPS.
    const r = await call<Driver>('/drivers/me/go-offline', { method: 'POST' });
    if (r.ok && r.data) setDriver(r.data);
    else setError(r.error);
    setBusy(null);
  }

  async function respond(action: 'accept' | 'reject') {
    if (!tripId) return;
    setBusy(action);
    setError(null);
    const r = await call<Trip>(`/trips/${tripId}/${action}`, { method: 'POST' });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (action === 'accept') router.push(`/tai-xe/chuyen-di/${tripId}`);
    else await refresh();
  }

  // Đổi tọa độ ra địa chỉ theo ô ~100 m để không gọi Geocoding API ở mọi lần GPS cập nhật.
  const coarseKey = position ? `${position.lat.toFixed(3)},${position.lng.toFixed(3)}` : '';
  const coarse = useMemo(() => (position ? { lat: position.lat, lng: position.lng } : null), [coarseKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const placeName = useAddressOf(coarse);
  // Lộ trình từ tài xế tới điểm đón khách khi có cuốc.
  const { route: toPickup } = useRoute(online && trip && driver.status === 'RESERVED' ? coarse : null, trip?.pickup);
  const gpsProblem = gpsErrorMessage(tracking.error);

  const status = DRIVER_STATUS[driver.status];
  const remaining = offeredAt ? Math.max(0, RESERVATION_SECONDS - Math.floor((now - offeredAt) / 1000)) : null;
  const pickupName = useAddressOf(trip?.pickup ?? null);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[400px_1fr]">
      <aside className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Xin chào, {name.split(' ').slice(-1)[0]}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {VEHICLE[driver.vehicleType] ?? driver.vehicleType} · <span className="font-mono font-semibold text-slate-700">{driver.licensePlate}</span>
          </p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Trạng thái</span>
            <Pill tone={status.tone} pulse={driver.status !== 'OFFLINE'}>
              {status.label}
            </Pill>
          </div>
          {(driver.status === 'OFFLINE' || driver.status === 'AVAILABLE') && (
            <button
              type="button"
              onClick={() => void (driver.status === 'OFFLINE' ? goOnline() : goOffline())}
              disabled={busy === 'toggle'}
              className={clsx(
                'mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:opacity-60',
                driver.status === 'OFFLINE' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {busy === 'toggle' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              {busy === 'toggle' && driver.status === 'OFFLINE' ? 'Đang xác định vị trí…' : driver.status === 'OFFLINE' ? 'Bật nhận cuốc' : 'Tắt nhận cuốc'}
            </button>
          )}
          {driver.status === 'OFFLINE' && <p className="mt-3 text-xs text-slate-500">Khi bật, ứng dụng lấy vị trí GPS hiện tại của bạn và theo dõi liên tục cho đến khi bạn tắt.</p>}
          {driver.status === 'AVAILABLE' && <p className="mt-3 text-xs text-slate-500">Bạn đang hiển thị với khách gần đó. Cuốc mới sẽ xuất hiện tại đây.</p>}
          {online && gpsProblem && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{gpsProblem}</div>}
          {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        </section>

        {driver.status === 'RESERVED' && trip && (
          <section className="overflow-hidden rounded-2xl border-2 border-amber-400 bg-white shadow-lg">
            <div className="flex items-center justify-between bg-amber-50 px-5 py-3">
              <span className="font-semibold text-amber-900">Cuốc mới!</span>
              {remaining !== null && <span className="font-mono text-sm font-bold text-amber-800">{remaining}s</span>}
            </div>
            <div className="space-y-3 p-5">
              <div className="flex items-start gap-3 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <div>
                  <div className="text-xs text-slate-500">Đón khách tại</div>
                  <div className="font-medium text-slate-900">{pickupName ?? coord(trip.pickup)}</div>
                  {toPickup && (
                    <div className="mt-0.5 text-xs text-slate-500">
                      Cách bạn {formatDistance(toPickup.distanceMeters)} · khoảng {formatDuration(toPickup.durationSeconds)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-end justify-between border-t border-slate-100 pt-3">
                <div>
                  <div className="text-xs text-slate-500">Cước chuyến</div>
                  <div className="text-2xl font-bold text-slate-900">{vnd(trip.fare)}</div>
                </div>
                <div className="text-sm text-slate-500">{trip.estimatedDistance} km</div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button type="button" onClick={() => void respond('reject')} disabled={!!busy} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Từ chối
                </button>
                <button type="button" onClick={() => void respond('accept')} disabled={!!busy} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                  {busy === 'accept' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Nhận cuốc
                </button>
              </div>
            </div>
          </section>
        )}

        {driver.status === 'ON_TRIP' && tripId && (
          <Link href={`/tai-xe/chuyen-di/${tripId}`} className="flex items-center justify-between rounded-2xl border border-violet-200 bg-violet-50 p-5 hover:bg-violet-100">
            <div>
              <div className="font-semibold text-violet-900">Bạn đang chở khách</div>
              <div className="text-sm text-violet-700">Mở chuyến để hoàn thành khi đến nơi</div>
            </div>
            <ArrowRight className="h-5 w-5 text-violet-700" />
          </Link>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Cuốc hôm nay</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{todayTrips}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Thu nhập hôm nay</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{vnd(todayEarnings)}</div>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <LocateFixed className="h-4 w-4 text-violet-600" /> Vị trí của bạn
            </span>
            {online ? (
              <Pill tone={gpsProblem ? 'amber' : 'green'} pulse={!gpsProblem}>
                {gpsProblem ? 'Mất tín hiệu' : 'Đang theo dõi GPS'}
              </Pill>
            ) : (
              <Pill tone="gray">Đã tắt định vị</Pill>
            )}
          </div>
          <div className="mt-3 text-sm font-medium text-slate-800">{online && position ? placeName ?? coord(position) : 'Vị trí chỉ được theo dõi khi bạn bật nhận cuốc'}</div>
          {online && position && (
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
              <span>Độ chính xác ±{position.accuracy} m</span>
              <span>{tracking.lastSent ? `Cập nhật lên hệ thống lúc ${new Date(tracking.lastSent).toLocaleTimeString('vi-VN')}` : 'Đang gửi…'}</span>
            </div>
          )}
        </section>
      </aside>

      <div className="h-[50vh] overflow-hidden rounded-2xl border border-slate-200 shadow-sm lg:h-[calc(100vh-7rem)]">
        <Map
          center={position ?? FALLBACK_CENTER}
          markers={[
            ...(online && position ? [{ id: 'me', position, kind: 'me' as const, label: 'Vị trí của bạn' }] : []),
            ...(trip ? [{ id: 'pickup', position: trip.pickup, kind: 'pickup' as const, label: trip.pickup.address ?? 'Điểm đón khách' }] : []),
          ]}
          route={online && position && trip && driver.status === 'RESERVED' ? [position, trip.pickup] : null}
          routePath={toPickup?.encodedPath}
          fit={[online ? position : null, trip?.pickup].filter(Boolean) as Point[]}
        />
      </div>
    </div>
  );
}
