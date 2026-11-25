'use client';

import clsx from 'clsx';
import { ArrowRight, Banknote, Check, Flame, Loader2, LocateFixed, MapPin, Power, Settings2, Star, Wallet, X, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { call } from '@/lib/client';
import { vnd } from '@/lib/format';
import { FALLBACK_CENTER, useAddressOf } from '@/lib/geo';
import { coord, DRIVER_STATUS, PAYMENT_METHOD, VEHICLE } from '@/lib/labels';
import { formatDistance, formatDuration, useRoute } from '@/lib/routes';
import { gpsErrorMessage, useDriverTracking } from '@/lib/tracking';
import type { BankAccount, DemandCell, DemandMap, Driver, DriverStats, Point, Trip } from '@/lib/types';
import type { HistoryItem } from './TripTracker';
import Map, { type MapCell } from './Map';
import Pill from './Pill';
import { PriceReasons } from './PriceBreakdown';

const RESERVATION_SECONDS = 60; // Driver Service tự nhả giữ chỗ sau 60 giây
const DEMAND_REFRESH_MS = 30_000;

// Màu ô theo hệ số giá động của khu vực: càng đỏ càng thiếu tài xế.
function cellStyle(c: DemandCell): { color: string; opacity: number } | null {
  if (c.multiplier >= 2) return { color: '#dc2626', opacity: 0.42 };
  if (c.multiplier >= 1.5) return { color: '#f97316', opacity: 0.36 };
  if (c.multiplier > 1) return { color: '#f59e0b', opacity: 0.28 };
  if (c.demand > 0 || c.recentRequests > 0) return { color: '#facc15', opacity: 0.16 };
  return null;
}

const factor = (m: number) => `×${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(m)}`;
const percent = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function distanceKm(a: Point, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function direction(from: Point, to: { lat: number; lng: number }) {
  const angle = (Math.atan2(to.lng - from.lng, to.lat - from.lat) * 180) / Math.PI;
  const names = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
  return names[Math.round(((angle + 360) % 360) / 45) % 8];
}

// Cài đặt nhận chuyến lưu trên thiết bị của tài xế.
function useLocalSetting(key: string, initial: boolean) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(stored === '1');
    } catch {
      /* trình duyệt chặn localStorage: dùng mặc định */
    }
  }, [key]);
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* bỏ qua */
      }
    },
    [key],
  );
  return [value, update] as const;
}

export default function DriverDashboard({ name, initialDriver, todayTrips, todayEarnings }: { name: string; initialDriver: Driver; todayTrips: number; todayEarnings: number }) {
  const router = useRouter();
  const [driver, setDriver] = useState(initialDriver);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [offeredAt, setOfferedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showSettings, setShowSettings] = useState(false);
  const [autoAccept, setAutoAccept] = useLocalSetting(`rf-auto-accept:${initialDriver.id}`, false);
  const [showDemand, setShowDemand] = useLocalSetting(`rf-demand-map:${initialDriver.id}`, true);
  const [demand, setDemand] = useState<DemandMap | null>(null);
  const [demandError, setDemandError] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [wallet, setWallet] = useState<BankAccount | null>(null);
  const [stats, setStats] = useState<DriverStats | null>(null);
  const autoAccepted = useRef<string | null>(null);

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

  // Ví và chỉ số hoạt động: tải một lần khi mở bảng điều khiển.
  useEffect(() => {
    void call<BankAccount>('/payments/bank/me').then(r => r.ok && setWallet(r.data));
    void call<DriverStats>('/trips/drivers/me/stats').then(r => r.ok && setStats(r.data));
  }, []);

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

  // Bản đồ nhu cầu quanh vị trí hiện tại, làm mới mỗi 30 giây (theo ô ~100 m để không gọi lại khi GPS nhích nhẹ).
  const demandKey = position ? `${position.lat.toFixed(3)},${position.lng.toFixed(3)}` : '';
  const loadDemand = useCallback(async () => {
    if (!position) return;
    const r = await call<DemandMap>(`/trips/demand-map?lat=${position.lat}&lng=${position.lng}&vehicleType=${driver.vehicleType}`);
    if (r.ok) {
      setDemand(r.data);
      setDemandError(null);
    } else setDemandError(r.error);
  }, [demandKey, driver.vehicleType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!online || !showDemand || !position) return;
    void loadDemand();
    const id = window.setInterval(() => void loadDemand(), DEMAND_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [online, showDemand, loadDemand]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const respond = useCallback(
    async (action: 'accept' | 'reject') => {
      if (!tripId) return;
      setBusy(action);
      setError(null);
      const r = await call<Trip>(`/trips/${tripId}/${action}`, { method: 'POST' });
      setBusy(null);
      if (!r.ok) return setError(r.error);
      if (action === 'accept') router.push(`/tai-xe/chuyen-di/${tripId}`);
      else await refresh();
    },
    [tripId, router, refresh],
  );

  // Tự động nhận cuốc: có cuốc mới và đã tải xong thông tin chuyến thì nhận ngay, mỗi cuốc một lần.
  useEffect(() => {
    if (!autoAccept || driver.status !== 'RESERVED' || !trip || trip.tripId !== tripId || trip.status !== 'AWAITING_DRIVER') return;
    if (autoAccepted.current === trip.tripId || busy) return;
    autoAccepted.current = trip.tripId;
    void respond('accept');
  }, [autoAccept, driver.status, trip, tripId, busy, respond]);

  // Đổi tọa độ ra địa chỉ theo ô ~100 m để không gọi Geocoding API ở mọi lần GPS cập nhật.
  const coarse = useMemo(() => (position ? { lat: position.lat, lng: position.lng } : null), [demandKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const placeName = useAddressOf(coarse);
  // Lộ trình từ tài xế tới điểm đón khách khi có cuốc.
  const { route: toPickup } = useRoute(online && trip && driver.status === 'RESERVED' ? coarse : null, trip?.pickup);
  const gpsProblem = gpsErrorMessage(tracking.error);

  const status = DRIVER_STATUS[driver.status];
  const remaining = offeredAt ? Math.max(0, RESERVATION_SECONDS - Math.floor((now - offeredAt) / 1000)) : null;
  const pickupName = useAddressOf(trip?.pickup ?? null);
  const destinationName = useAddressOf(trip?.destination ?? null);

  // Ô tô màu và khu vực nóng gần nhất để gợi ý tài xế di chuyển tới.
  const demandCells: MapCell[] =
    online && showDemand && demand
      ? demand.cells.flatMap(c => {
          const style = cellStyle(c);
          return style ? [{ id: c.cellId, bounds: c.bounds, ...style }] : [];
        })
      : [];
  const hotspots = useMemo(() => {
    if (!demand || !position) return [];
    return demand.cells
      .filter(c => c.multiplier > 1 || c.demand > 0)
      .map(c => ({ ...c, km: distanceKm(position, c.center) }))
      .sort((a, b) => b.multiplier - a.multiplier || b.demand - a.demand || a.km - b.km)
      .slice(0, 3);
  }, [demand, position]);
  const selected = demand?.cells.find(c => c.cellId === selectedCell) ?? null;
  const cashDebt = wallet ? Number(wallet.balance) < 0 : false;

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[400px_1fr]">
      <aside className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Xin chào, {name.split(' ').slice(-1)[0]}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {VEHICLE[driver.vehicleType] ?? driver.vehicleType} · <span className="font-mono font-semibold text-slate-700">{driver.licensePlate}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSettings(v => !v)}
            className={clsx('flex h-10 w-10 items-center justify-center rounded-xl border transition', showSettings ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
            aria-label="Cài đặt nhận chuyến"
            aria-expanded={showSettings}
          >
            <Settings2 className="h-5 w-5" />
          </button>
        </div>

        {showSettings && (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Cài đặt nhận chuyến</div>
            <Toggle
              checked={autoAccept}
              onChange={setAutoAccept}
              icon={<Zap className="h-4 w-4 text-amber-500" />}
              title="Tự động nhận chuyến"
              description="Cuốc mới được nhận ngay, không cần bấm. Vẫn có thể hủy nếu khách không xuất hiện."
            />
            <Toggle
              checked={showDemand}
              onChange={setShowDemand}
              icon={<Flame className="h-4 w-4 text-orange-500" />}
              title="Bản đồ nhu cầu"
              description="Tô màu khu vực đang có nhiều khách hơn tài xế, kèm hệ số giá."
            />
            <p className="text-xs text-slate-400">Cài đặt được lưu trên thiết bị này.</p>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Trạng thái</span>
            <div className="flex items-center gap-2">
              {autoAccept && online && (
                <Pill tone="amber">
                  <Zap className="h-3 w-3" /> Tự nhận
                </Pill>
              )}
              <Pill tone={status.tone} pulse={driver.status !== 'OFFLINE'}>
                {status.label}
              </Pill>
            </div>
          </div>
          {(driver.status === 'OFFLINE' || driver.status === 'AVAILABLE') && (
            <button
              type="button"
              onClick={() => void (driver.status === 'OFFLINE' ? goOnline() : goOffline())}
              disabled={busy === 'toggle'}
              className={clsx(
                'mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold transition disabled:opacity-60',
                driver.status === 'OFFLINE' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {busy === 'toggle' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Power className="h-5 w-5" />}
              {busy === 'toggle' && driver.status === 'OFFLINE' ? 'Đang xác định vị trí…' : driver.status === 'OFFLINE' ? 'Bật nhận cuốc' : 'Tắt nhận cuốc'}
            </button>
          )}
          {driver.status === 'OFFLINE' && <p className="mt-3 text-xs text-slate-500">Khi bật, ứng dụng lấy vị trí GPS hiện tại của bạn và theo dõi liên tục cho đến khi bạn tắt.</p>}
          {driver.status === 'AVAILABLE' && <p className="mt-3 text-xs text-slate-500">Bạn đang hiển thị với khách gần đó. Cuốc mới sẽ xuất hiện tại đây.</p>}
          {cashDebt && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Ví đang âm {vnd(Math.abs(Number(wallet?.balance)))} do chiết khấu chuyến tiền mặt.{' '}
              <Link href="/tai-xe/vi" className="font-semibold underline">
                Nạp ví
              </Link>
            </div>
          )}
          {online && gpsProblem && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{gpsProblem}</div>}
          {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        </section>

        {driver.status === 'RESERVED' && trip && (
          <section className="overflow-hidden rounded-2xl border-2 border-amber-400 bg-white shadow-lg">
            <div className="flex items-center justify-between bg-amber-50 px-5 py-3">
              <span className="flex items-center gap-2 font-semibold text-amber-900">
                Cuốc mới! <span className="text-xs font-normal text-amber-700">{VEHICLE[trip.vehicleType ?? 'MOTORCYCLE']}</span>
              </span>
              {autoAccept ? (
                <span className="flex items-center gap-1 text-sm font-semibold text-amber-800">
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang tự nhận…
                </span>
              ) : (
                remaining !== null && <span className="font-mono text-sm font-bold text-amber-800">{remaining}s</span>
              )}
            </div>
            <div className="space-y-3 p-5">
              <div className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">A</span>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Đón khách tại</div>
                  <div className="font-medium text-slate-900">{pickupName ?? coord(trip.pickup)}</div>
                  {toPickup && (
                    <div className="mt-0.5 text-xs text-slate-500">
                      Cách bạn {formatDistance(toPickup.distanceMeters)} · khoảng {formatDuration(toPickup.durationSeconds)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white">B</span>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Trả khách tại</div>
                  <div className="font-medium text-slate-900">{destinationName ?? coord(trip.destination)}</div>
                  <div className="mt-0.5 text-xs text-slate-500">Quãng đường chuyến {trip.estimatedDistance} km</div>
                </div>
              </div>
              {trip.noteForDriver && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span className="font-semibold">Ghi chú của khách: </span>
                  {trip.noteForDriver}
                </div>
              )}
              <div className="flex items-end justify-between border-t border-slate-100 pt-3">
                <div>
                  <div className="text-xs text-slate-500">Cước chuyến</div>
                  <div className="text-2xl font-bold text-slate-900">{vnd(trip.fare)}</div>
                </div>
                <span
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
                    trip.paymentMethod === 'CASH' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
                  )}
                >
                  {trip.paymentMethod === 'CASH' ? <Banknote className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                  {trip.paymentMethod === 'CASH' ? 'Thu tiền mặt' : PAYMENT_METHOD.BANK}
                </span>
              </div>
              <PriceReasons snapshot={trip.pricingSnapshot} />
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
              <div className="font-semibold text-violet-900">Bạn đang có chuyến</div>
              <div className="text-sm text-violet-700">Mở chuyến để dẫn đường và cập nhật từng bước</div>
            </div>
            <ArrowRight className="h-5 w-5 text-violet-700" />
          </Link>
        )}

        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Cuốc hôm nay" value={String(todayTrips)} />
          <MiniStat label="Thu nhập hôm nay" value={vnd(todayEarnings)} href="/tai-xe/thu-nhap" />
          <MiniStat label="Số dư ví" value={wallet ? vnd(wallet.balance) : '—'} tone={cashDebt ? 'red' : undefined} href="/tai-xe/vi" />
          <MiniStat
            label="Đánh giá"
            value={
              stats?.rating.average != null ? (
                <span className="inline-flex items-center gap-1">
                  {stats.rating.average.toFixed(2)} <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                </span>
              ) : (
                'Chưa có'
              )
            }
            hint={stats ? `Nhận ${percent(stats.acceptanceRate)} · Hủy ${percent(stats.cancellationRate)}` : undefined}
            href="/tai-xe/hieu-suat"
          />
        </div>

        {online && showDemand && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Flame className="h-4 w-4 text-orange-500" /> Khu vực nhu cầu cao
              </span>
              {demand && <span className="text-xs text-slate-400">cập nhật {new Date(demand.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
            {demandError && <p className="mt-2 text-xs text-amber-700">Chưa tải được bản đồ nhu cầu ({demandError}).</p>}
            {demand && hotspots.length === 0 && <p className="mt-2 text-sm text-slate-500">Quanh bạn chưa có khu vực thiếu tài xế. Giá đang ở mức tiêu chuẩn.</p>}
            <ul className="mt-2 space-y-2">
              {hotspots.map(h => (
                <li key={h.cellId}>
                  <button type="button" onClick={() => setSelectedCell(h.cellId)} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-left text-sm hover:bg-slate-100">
                    <span>
                      <span className="font-medium text-slate-800">
                        {h.km < 0.6 ? 'Ngay quanh bạn' : `${h.km.toFixed(1)} km về phía ${direction(position!, h.center)}`}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {h.demand} khách chờ · {h.availableDrivers} tài xế rảnh
                      </span>
                    </span>
                    <span className={clsx('rounded-lg px-2 py-1 text-xs font-bold', h.multiplier >= 1.5 ? 'bg-red-100 text-red-700' : h.multiplier > 1 ? 'bg-amber-100 text-amber-800' : 'bg-yellow-50 text-yellow-700')}>
                      {factor(h.multiplier)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

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

      <div className="relative h-[50vh] overflow-hidden rounded-2xl border border-slate-200 shadow-sm lg:h-[calc(100vh-7rem)]">
        <Map
          center={position ?? FALLBACK_CENTER}
          markers={[
            ...(online && position ? [{ id: 'me', position, kind: 'me' as const, label: 'Vị trí của bạn' }] : []),
            ...(trip ? [{ id: 'pickup', position: trip.pickup, kind: 'pickup' as const, label: trip.pickup.address ?? 'Điểm đón khách' }] : []),
          ]}
          cells={demandCells}
          onCellClick={setSelectedCell}
          route={online && position && trip && driver.status === 'RESERVED' ? [position, trip.pickup] : null}
          routePath={toPickup?.encodedPath}
          fit={
            trip || demandCells.length === 0
              ? ([online ? position : null, trip?.pickup].filter(Boolean) as Point[])
              : // Không có cuốc: thu bản đồ vừa các ô đang có màu để thấy rõ khu vực nóng quanh mình.
                [
                  ...(position ? [position] : []),
                  ...demandCells.flatMap(c => [
                    { lat: c.bounds.north, lng: c.bounds.east },
                    { lat: c.bounds.south, lng: c.bounds.west },
                  ]),
                ]
          }
        />
        {demandCells.length > 0 && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/95 px-3 py-2 text-xs shadow-md ring-1 ring-slate-200">
            <div className="mb-1 font-semibold text-slate-800">Nhu cầu đặt xe</div>
            {[
              ['#facc15', 'Có khách đặt gần đây'],
              ['#f59e0b', 'Hơi thiếu tài xế ×1,2'],
              ['#f97316', 'Thiếu tài xế ×1,5'],
              ['#dc2626', 'Rất thiếu tài xế ×2'],
            ].map(([color, label]) => (
              <div key={label} className="flex items-center gap-2 text-slate-600">
                <span className="h-3 w-3 rounded-sm" style={{ background: color, opacity: 0.75 }} /> {label}
              </div>
            ))}
          </div>
        )}
        {selected && (
          <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-white/95 p-3 text-sm shadow-lg ring-1 ring-slate-200 sm:right-auto sm:w-72">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900">Khu vực {factor(selected.multiplier)}</span>
              <button type="button" onClick={() => setSelectedCell(null)} className="text-slate-400 hover:text-slate-600" aria-label="Đóng">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              <li>
                {selected.demand} khách đang chờ, {selected.availableDrivers} tài xế rảnh trong {demand?.radiusKm ?? 3} km
              </li>
              <li>
                {selected.recentRequests} lượt đặt trong {demand?.recentMinutes ?? 30} phút qua
              </li>
              {position && <li>Cách bạn {distanceKm(position, selected.center).toFixed(1)} km</li>}
            </ul>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${selected.center.lat},${selected.center.lng}&travelmode=driving`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
            >
              <MapPin className="h-3.5 w-3.5" /> Dẫn đường tới khu vực này
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, icon, title, description }: { checked: boolean; onChange: (v: boolean) => void; icon: ReactNode; title: string; description: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}
      >
        <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

function MiniStat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: string; href?: string; tone?: 'red' }) {
  const body = (
    <>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={clsx('mt-1 text-lg font-bold', tone === 'red' ? 'text-red-600' : 'text-slate-900')}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:bg-brand-50/40">
      {body}
    </Link>
  ) : (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">{body}</div>
  );
}
