'use client';

import clsx from 'clsx';
import { ArrowRight, Bike, Car, Hand, Loader2, Navigation, RefreshCw, Route, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/client';
import { vnd } from '@/lib/format';
import { FALLBACK_CENTER, useBrowserLocation, useReverseGeocoder } from '@/lib/geo';
import { TRIP_STATUS, VEHICLE } from '@/lib/labels';
import { formatDistance, formatDuration, useRoute } from '@/lib/routes';
import type { Driver, FareEstimate, FareRate, Point, Trip, VehicleType } from '@/lib/types';
import AddressInput from './AddressInput';
import Map, { type MapMarker } from './Map';
import Pill from './Pill';

const SEARCH_RADIUS_KM = 5;

export default function BookingClient({
  firstName,
  activeTrip,
  rates,
  loadError,
}: {
  firstName: string;
  activeTrip: Trip | null;
  rates: FareRate[];
  loadError: string | null;
}) {
  const [vehicleType, setVehicleType] = useState<VehicleType>(rates[0]?.vehicleType ?? 'MOTORCYCLE');
  const router = useRouter();
  // Không tự lấy GPS: khách nhập địa chỉ trước, chỉ định vị khi bấm "Vị trí của tôi".
  const { location, status: geoStatus, locate } = useBrowserLocation(false);
  const reverse = useReverseGeocoder();
  const [pickup, setPickup] = useState<Point | null>(null);
  const [destination, setDestination] = useState<Point | null>(null);
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [estimate, setEstimate] = useState<FareEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tài xế sẵn sàng quanh điểm đón: Redis GEO + trạng thái AVAILABLE trong driver_db.
  const loadDrivers = useCallback(async () => {
    if (!pickup) return setDrivers(null);
    const r = await call<Driver[]>(`/drivers/available?lat=${pickup.lat}&lng=${pickup.lng}&radius=${SEARCH_RADIUS_KM}`);
    setDrivers(r.ok ? r.data ?? [] : null);
  }, [pickup]);

  useEffect(() => {
    void loadDrivers();
    const id = window.setInterval(() => void loadDrivers(), 10000);
    return () => window.clearInterval(id);
  }, [loadDrivers]);

  // Giá cước do Trip Service tính; client không tự tính.
  useEffect(() => {
    setEstimate(null);
    if (!pickup || !destination) return;
    let cancelled = false;
    setEstimating(true);
    call<FareEstimate>('/trips/estimate', { body: { pickup, destination } }).then(r => {
      if (cancelled) return;
      setEstimating(false);
      if (r.ok) setEstimate(r.data);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [pickup, destination]);

  async function fillMyLocation() {
    const point = await locate();
    if (!point) return setError('Trình duyệt không cho phép định vị. Hãy nhập địa chỉ điểm đón.');
    setError(null);
    setPickup({ ...point, address: (await reverse(point)) ?? 'Vị trí hiện tại' });
  }

  // Kéo ghim để chỉnh vị trí chính xác; địa chỉ được cập nhật theo vị trí mới.
  async function moved(id: string, point: Point) {
    const address = (await reverse(point)) ?? undefined;
    const update = (prev: Point | null) => (prev ? { ...point, address: address ?? prev.address } : prev);
    if (id === 'pickup') setPickup(update);
    if (id === 'destination') setDestination(update);
  }

  async function book() {
    if (!pickup || !destination) return;
    setBooking(true);
    setError(null);
    const r = await call<Trip>('/trips', { body: { pickup, destination, vehicleType } });
    if (r.ok && r.data) {
      router.push(`/khach-hang/chuyen-di/${r.data.tripId}`);
      router.refresh();
    } else {
      setError(r.error);
      setBooking(false);
    }
  }

  const { route, loading: routing } = useRoute(pickup, destination);
  // Báo giá của loại xe đang chọn (Trip Service trả giá của mọi loại xe trong một lần gọi).
  const chosen = estimate?.options?.find(o => o.vehicleType === vehicleType) ?? null;
  const selectedNearby = drivers?.filter(d => d.vehicleType === vehicleType) ?? null;

  const markers: MapMarker[] = [
    ...(pickup ? [{ id: 'pickup', position: pickup, kind: 'pickup' as const, label: pickup.address ?? 'Điểm đón', draggable: true }] : []),
    ...(destination ? [{ id: 'destination', position: destination, kind: 'destination' as const, label: destination.address ?? 'Điểm đến', draggable: true }] : []),
  ];
  const fitPoints = [pickup, destination].filter(Boolean) as Point[];

  return (
    <div className="mx-auto grid max-w-7xl gap-0 lg:grid-cols-[440px_1fr] lg:gap-6 lg:px-6 lg:py-6">
      <aside className="order-2 space-y-4 px-4 py-6 lg:order-1 lg:px-0 lg:py-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Chào {firstName}, bạn muốn đi đâu?</h1>
          <p className="mt-1 text-sm text-slate-500">Nhập địa chỉ đón và địa chỉ đến; ghim sẽ hiện trên bản đồ sau khi bạn chọn địa chỉ.</p>
        </div>

        {loadError && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{loadError}</div>}

        {activeTrip && (
          <Link href={`/khach-hang/chuyen-di/${activeTrip.tripId}`} className="flex items-center justify-between rounded-2xl border border-brand-200 bg-brand-50 p-4 hover:bg-brand-100">
            <div>
              <div className="text-sm font-semibold text-brand-800">Bạn đang có một chuyến</div>
              <div className="mt-1">
                <Pill tone={TRIP_STATUS[activeTrip.status].tone} pulse>
                  {TRIP_STATUS[activeTrip.status].label}
                </Pill>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-brand-700" />
          </Link>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <AddressInput
            label="Điểm đón"
            letter="A"
            color="bg-brand-600"
            value={pickup}
            placeholder="Nhập địa chỉ đón, ví dụ: 122 Hoàng Quốc Việt"
            bias={pickup ?? location}
            onSelect={p => {
              setError(null);
              setPickup(p);
            }}
            onClear={() => setPickup(null)}
            onUseMyLocation={() => void fillMyLocation()}
            locating={geoStatus === 'locating'}
            autoFocus
          />
          <div className="mx-4 border-t border-dashed border-slate-200" />
          <AddressInput
            label="Điểm đến"
            letter="B"
            color="bg-rose-600"
            value={destination}
            placeholder="Nhập địa chỉ đến"
            bias={pickup ?? location}
            onSelect={p => {
              setError(null);
              setDestination(p);
            }}
            onClear={() => setDestination(null)}
          />
        </div>
        {pickup && destination && (
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <Route className="h-5 w-5 shrink-0 text-brand-600" />
            {routing && !route ? (
              <span className="text-slate-500">Đang tìm lộ trình…</span>
            ) : route ? (
              <span className="text-slate-700">
                Lộ trình <strong className="text-slate-900">{formatDistance(route.distanceMeters)}</strong> · khoảng{' '}
                <strong className="text-slate-900">{formatDuration(route.durationSeconds)}</strong> theo giao thông hiện tại
              </span>
            ) : (
              <span className="text-slate-500">Không tìm được lộ trình lái xe giữa hai điểm này.</span>
            )}
          </div>
        )}
        {(pickup || destination) && (
          <p className="flex items-center gap-1.5 px-1 text-xs text-slate-500">
            <Hand className="h-3.5 w-3.5" /> Kéo ghim trên bản đồ nếu cần chỉnh vị trí đón chính xác hơn.
          </p>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between px-1 text-sm">
            <span className="font-semibold text-slate-900">Chọn loại xe</span>
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <Users className="h-3.5 w-3.5" /> tài xế sẵn sàng trong {SEARCH_RADIUS_KM} km
              {pickup && (
                <button type="button" onClick={() => void loadDrivers()} className="text-slate-400 hover:text-slate-600" aria-label="Tải lại">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          </div>
          <div className="space-y-2" role="radiogroup" aria-label="Loại xe">
            {rates.map(rate => {
              const option = estimate?.options?.find(o => o.vehicleType === rate.vehicleType);
              const nearby = drivers?.filter(d => d.vehicleType === rate.vehicleType) ?? null;
              const nearest = nearby?.[0];
              const selected = vehicleType === rate.vehicleType;
              const Icon = rate.vehicleType === 'MOTORCYCLE' ? Bike : Car;
              return (
                <button
                  key={rate.vehicleType}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setVehicleType(rate.vehicleType)}
                  className={clsx(
                    'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                    selected ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">
                      {rate.displayName} <span className="font-normal text-slate-400">· {rate.seats} chỗ</span>
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {!pickup
                        ? `${vnd(rate.baseFare)} mở cửa + ${vnd(rate.perKm)}/km`
                        : nearby === null
                          ? 'Đang tìm tài xế…'
                          : nearby.length === 0
                            ? 'Chưa có tài xế gần bạn'
                            : `${nearby.length} tài xế · gần nhất ${nearest?.distance != null ? `${nearest.distance.toFixed(1)} km` : ''}`}
                    </span>
                  </span>
                  <span className="text-right">
                    {estimating ? (
                      <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    ) : option ? (
                      <span className="block text-base font-bold text-slate-900">{vnd(option.fareAmount)}</span>
                    ) : (
                      <span className="block text-xs text-slate-400">—</span>
                    )}
                  </span>
                </button>
              );
            })}
            {rates.length === 0 && <p className="px-1 text-sm text-slate-500">Chưa tải được bảng giá.</p>}
          </div>
          {chosen && <div className="mt-3 px-1 text-xs text-slate-500">Giá tính theo khoảng cách {chosen.estimatedDistance} km giữa điểm đón và điểm đến.</div>}
          {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <button
            type="button"
            onClick={() => void book()}
            disabled={!chosen || booking || !!activeTrip}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
            {activeTrip
              ? 'Hoàn tất chuyến hiện tại trước'
              : !pickup || !destination
                ? 'Nhập đủ điểm đón và điểm đến'
                : chosen
                  ? `Đặt ${rates.find(r => r.vehicleType === vehicleType)?.displayName.toLowerCase() ?? 'xe'} · ${vnd(chosen.fareAmount)}`
                  : 'Đặt xe'}
          </button>
          {pickup && selectedNearby !== null && selectedNearby.length === 0 && (
            <p className="mt-3 text-xs text-amber-700">Hiện chưa có tài xế loại xe này gần bạn. Bạn vẫn có thể đặt; hệ thống sẽ thử ghép, nếu không có sẽ báo không thành công.</p>
          )}
        </div>
      </aside>

      <div className="order-1 h-[45vh] overflow-hidden lg:order-2 lg:h-[calc(100vh-7rem)] lg:rounded-2xl lg:border lg:border-slate-200 lg:shadow-sm">
        <Map
          center={FALLBACK_CENTER}
          markers={markers}
          route={pickup && destination ? [pickup, destination] : null}
          routePath={route?.encodedPath}
          fit={fitPoints}
          onMarkerDragEnd={(id, p) => void moved(id, p)}
        />
      </div>
    </div>
  );
}
