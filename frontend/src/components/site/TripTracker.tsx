'use client';

import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  Banknote,
  Bike,
  Car,
  Check,
  CheckCheck,
  CircleDot,
  Flag,
  Gift,
  HeartHandshake,
  Landmark,
  Loader2,
  MessageSquareText,
  Navigation,
  Phone,
  RotateCcw,
  Share2,
  ShieldAlert,
  Star,
  UserCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { call } from '@/lib/client';
import { time, vnd } from '@/lib/format';
import { useAddressOf } from '@/lib/geo';
import { CANCELLABLE, coord, DRIVER_CANCEL_REASON, FAILURE_REASON, OPEN_TRIP, PAYMENT_METHOD, PAYMENT_STATUS, RATING_TAG, TRIP_PHASE, TRIP_REASON, TRIP_STATUS, VEHICLE } from '@/lib/labels';
import { formatDistance, formatDuration, useRoute } from '@/lib/routes';
import { gpsErrorMessage, useDriverTracking } from '@/lib/tracking';
import type {
  Driver,
  DriverCancelReason,
  DriverLocationInfo,
  EmergencyContact,
  Payment,
  Point,
  RatingSummary,
  TipInfo,
  Trip,
  TripRating,
  TripStatus,
  UserProfile,
} from '@/lib/types';
import Map, { type MapMarker } from './Map';
import Pill from './Pill';
import { PriceBreakdown, PriceReasons } from './PriceBreakdown';

export interface HistoryItem {
  previousStatus: TripStatus | null;
  status: TripStatus;
  reason: string | null;
  createdAt: string;
}

type Viewer = 'passenger' | 'driver';

const OFFER_SECONDS = 60; // Driver Service nhả giữ chỗ sau 60 giây; Trip Service chuyển cuốc cho tài xế khác
const SEARCH_SECONDS = 180; // Matching tìm tài xế tối đa 3 phút rồi mới báo không tìm được
const NO_SHOW_SECONDS = 120; // Trip Service chỉ nhận báo "khách không xuất hiện" sau 2 phút chờ ở điểm đón
const RATABLE: TripStatus[] = ['PAYMENT_PENDING', 'CONFIRMED', 'COMPLETED'];

const HINT: Partial<Record<TripStatus, Record<Viewer, string>>> = {
  REQUESTED: { passenger: 'Đang xác nhận thanh toán…', driver: '' },
  MATCHING: { passenger: 'Hệ thống đang tìm tài xế gần bạn nhất…', driver: '' },
  AWAITING_DRIVER: { passenger: 'Đã tìm thấy tài xế, đang chờ tài xế xác nhận.', driver: 'Bạn có cuốc mới. Xác nhận trong 60 giây, quá hạn cuốc sẽ được chuyển cho tài xế khác.' },
  PAYMENT_PENDING: { passenger: 'Chuyến đã kết thúc, đang thanh toán.', driver: 'Đã kết thúc chuyến, đang chờ thanh toán.' },
  CONFIRMED: { passenger: 'Chuyến đi hoàn tất. Cảm ơn bạn đã sử dụng RideFlow!', driver: 'Chuyến đã hoàn tất và được thanh toán.' },
  CANCELLED: { passenger: 'Chuyến đã được hủy.', driver: 'Khách đã hủy chuyến.' },
  FAILED: { passenger: 'Rất tiếc, chưa tìm được tài xế hoặc thanh toán không thành công.', driver: 'Chuyến không thành công.' },
};

// Mốc trong lịch sử: các bước giữa chuyến có cùng status IN_PROGRESS nên đọc theo lý do.
function historyLabel(h: HistoryItem) {
  if (h.reason === 'driver arrived at pickup') return 'Tài xế đã đến điểm đón';
  if (h.reason === 'passenger picked up') return 'Đã đón khách';
  if (h.status === 'IN_PROGRESS' && h.previousStatus === 'AWAITING_DRIVER') return 'Tài xế đã nhận chuyến';
  if (h.status === 'CANCELLED' && h.reason?.startsWith('driver cancelled')) return 'Tài xế đã hủy chuyến';
  if (h.status === 'MATCHING' && (h.reason === 'driver rejected' || h.reason === 'driver response timeout')) return 'Tài xế không nhận, đang tìm tài xế khác';
  return TRIP_STATUS[h.status]?.label ?? h.status;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const mapsUrl = (to: Point, motorbike: boolean) =>
  `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=${motorbike ? 'two-wheeler' : 'driving'}`;

export default function TripTracker({ viewer, initialTrip, initialHistory }: { viewer: Viewer; initialTrip: Trip; initialHistory: HistoryItem[] }) {
  const router = useRouter();
  const [trip, setTrip] = useState(initialTrip);
  const [history, setHistory] = useState(initialHistory);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [driverRating, setDriverRating] = useState<RatingSummary | null>(null);
  const [passenger, setPassenger] = useState<UserProfile | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [shared, setShared] = useState<string | null>(null);

  const id = trip.tripId;
  const open = OPEN_TRIP.includes(trip.status);
  const helpHref = viewer === 'driver' ? '/tai-xe/tro-giup' : '/khach-hang/tro-giup';

  const refresh = useCallback(async () => {
    const [t, h] = await Promise.all([call<Trip>(`/trips/${id}`), call<HistoryItem[]>(`/trips/${id}/history`)]);
    if (t.ok && t.data) setTrip(t.data);
    if (h.ok && h.data) setHistory(h.data);
    if (t.status === 403 || t.status === 404) router.refresh();
  }, [id, router]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  // Thông tin bên còn lại của chuyến, lấy từ Driver Service / User Service; điểm đánh giá từ Trip Service.
  useEffect(() => {
    if (viewer === 'passenger' && trip.driverId) {
      void call<Driver>(`/drivers/${trip.driverId}`).then(r => r.ok && setDriver(r.data));
      void call<RatingSummary>(`/trips/drivers/${trip.driverId}/rating`).then(r => r.ok && setDriverRating(r.data));
    }
    if (viewer === 'passenger' && !trip.driverId) setDriver(null);
    if (viewer === 'driver') void call<UserProfile>(`/users/${trip.passengerId}`).then(r => r.ok && setPassenger(r.data));
  }, [viewer, trip.driverId, trip.passengerId]);

  const loadPayment = useCallback(async () => {
    const r = await call<Payment>(`/payments/trips/${id}`);
    setPayment(r.ok ? r.data : null);
  }, [id]);

  // Đang chờ thanh toán thì hỏi lại Payment mỗi 3 giây: giao dịch được tạo sau khi Payment nhận trip.completed,
  // và chuyến tiền mặt chuyển SUCCESS khi tài xế xác nhận đã thu tiền.
  // Payment chỉ cho hành khách xem giao dịch của chuyến; tài xế xác nhận tiền mặt mà không cần đọc giao dịch.
  useEffect(() => {
    if (viewer !== 'passenger' || !['PAYMENT_PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'].includes(trip.status)) return;
    void loadPayment();
    if (trip.status !== 'PAYMENT_PENDING') return;
    const timer = window.setInterval(() => void loadPayment(), 3000);
    return () => window.clearInterval(timer);
  }, [viewer, trip.status, loadPayment]);

  // Tài xế đang chạy chuyến: tiếp tục gửi GPS lên Driver Service và dùng vị trí để dẫn đường.
  const sendLocation = useCallback(async (point: Point) => (await call('/drivers/me/location', { body: { latitude: point.lat, longitude: point.lng } })).ok, []);
  const driving = viewer === 'driver' && trip.status === 'IN_PROGRESS';
  const tracking = useDriverTracking(driving, sendLocation);
  const myKey = tracking.fix ? `${tracking.fix.lat.toFixed(3)},${tracking.fix.lng.toFixed(3)}` : '';
  const me = useMemo(() => (tracking.fix ? { lat: tracking.fix.lat, lng: tracking.fix.lng } : null), [myKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmCash() {
    if (!window.confirm(`Xác nhận bạn đã nhận ${vnd(trip.fare)} tiền mặt từ khách?`)) return;
    setBusy('cash');
    setError(null);
    const r = await call<Payment>(`/payments/trips/${id}/cash-confirm`, { method: 'POST' });
    setBusy(null);
    // 404: Payment chưa nhận trip.completed nên chưa có phiếu thu; vài giây sau bấm lại.
    if (r.status === 404) return setError('Payment Service chưa ghi nhận chuyến này, thử lại sau vài giây.');
    if (!r.ok) return setError(r.error);
    setPayment(r.data);
    await refresh();
    router.refresh();
  }

  async function act(action: 'cancel' | 'accept' | 'reject' | 'complete' | 'arrived' | 'pickup') {
    if (action === 'cancel' && !window.confirm('Bạn chắc chắn muốn hủy chuyến?')) return;
    if (action === 'reject' && !window.confirm('Từ chối cuốc này?')) return;
    setBusy(action);
    setError(null);
    const r = await call<Trip>(`/trips/${id}/${action}`, { method: 'POST' });
    setBusy(null);
    if (!r.ok) setError(r.error);
    if (action === 'reject' && r.ok) {
      router.push('/tai-xe');
      router.refresh();
      return;
    }
    if (r.ok && r.data) setTrip(r.data);
    await refresh();
    router.refresh();
  }

  async function driverCancel(reason: DriverCancelReason) {
    if (!window.confirm(`Hủy chuyến với lý do "${DRIVER_CANCEL_REASON[reason]}"? Lần hủy này được tính vào tỷ lệ hủy của bạn.`)) return;
    setBusy('driver-cancel');
    setError(null);
    const r = await call<Trip>(`/trips/${id}/driver-cancel`, { body: { reason } });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setCancelOpen(false);
    if (r.data) setTrip(r.data);
    await refresh();
    router.refresh();
  }

  // Nội dung hành trình gửi người thân (chia sẻ hoặc tin nhắn SMS).
  function shareText() {
    return `Mình đang đi RideFlow${driver ? ` với tài xế ${driver.fullName}, xe ${driver.licensePlate}` : ''}. Từ: ${pickupName ?? coord(trip.pickup)}. Đến: ${destinationName ?? coord(trip.destination)}. Bản đồ: https://www.google.com/maps/dir/?api=1&origin=${trip.pickup.lat},${trip.pickup.lng}&destination=${trip.destination.lat},${trip.destination.lng}`;
  }

  // Chia sẻ hành trình cho người thân: dùng Web Share nếu có, không thì sao chép.
  async function shareTrip() {
    const text = shareText();
    try {
      if (navigator.share) await navigator.share({ title: 'Hành trình RideFlow', text });
      else {
        await navigator.clipboard.writeText(text);
        setShared('Đã sao chép thông tin hành trình, gửi cho người thân của bạn.');
      }
    } catch {
      /* người dùng hủy chia sẻ */
    }
  }

  const phase = trip.status === 'IN_PROGRESS' ? trip.tripPhase ?? 'TO_PICKUP' : null;
  const motorbike = (trip.vehicleType ?? 'MOTORCYCLE') === 'MOTORCYCLE';
  // Tài xế: dẫn đường từ vị trí hiện tại tới điểm đón (trước khi đón) hoặc tới điểm đến (khách đã lên xe).
  const navTarget = phase === 'ON_BOARD' ? trip.destination : trip.pickup;
  const { route } = useRoute(trip.pickup, trip.destination);
  const { route: navRoute } = useRoute(driving && me ? me : null, driving ? navTarget : null);

  // Khách theo dõi tài xế của chuyến: Trip Service kiểm tra quyền rồi hỏi Driver Service; làm mới mỗi 5 giây.
  const [driverLoc, setDriverLoc] = useState<DriverLocationInfo | null>(null);
  const watching = viewer === 'passenger' && !!trip.driverId && (trip.status === 'AWAITING_DRIVER' || trip.status === 'IN_PROGRESS');
  useEffect(() => {
    if (!watching) {
      setDriverLoc(null);
      return;
    }
    let stopped = false;
    const load = async () => {
      const r = await call<DriverLocationInfo>(`/trips/${id}/driver-location`);
      if (!stopped) setDriverLoc(r.ok ? r.data : null);
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [watching, id, trip.tripPhase]);
  // Lộ trình tài xế → đích: chỉ tính lại khi tài xế đi qua ô ~1 km để không tốn lượt gọi Routes API mỗi 5 giây.
  const driverCell = driverLoc ? `${driverLoc.position.lat.toFixed(2)},${driverLoc.position.lng.toFixed(2)},${driverLoc.target}` : '';
  const driverAnchor = useMemo(() => (driverLoc ? driverLoc.position : null), [driverCell]); // eslint-disable-line react-hooks/exhaustive-deps
  const passengerTarget = driverLoc?.target === 'DESTINATION' ? trip.destination : trip.pickup;
  const { route: driverRoute } = useRoute(watching ? driverAnchor : null, watching && driverAnchor ? passengerTarget : null);
  const tracked = watching && !!driverLoc;

  // Người thân để Trung tâm an toàn liên hệ nhanh (User Service).
  const [contacts, setContacts] = useState<EmergencyContact[] | null>(null);
  const safetyVisible = trip.status === 'IN_PROGRESS' || trip.status === 'AWAITING_DRIVER';
  useEffect(() => {
    if (!safetyVisible || contacts !== null) return;
    void call<EmergencyContact[]>('/users/me/emergency-contacts').then(r => setContacts(r.ok ? r.data ?? [] : []));
  }, [safetyVisible, contacts]);
  const pickupName = useAddressOf(trip.pickup);
  const destinationName = useAddressOf(trip.destination);
  const status = TRIP_STATUS[trip.status];

  const [now, setNow] = useState(Date.now());
  const awaiting = viewer === 'driver' && trip.status === 'AWAITING_DRIVER';
  // Matching tìm tài xế trong tối đa 3 phút kể từ lúc đặt; tài xế từ chối thì ghép tiếp người khác.
  const searching = viewer === 'passenger' && ['REQUESTED', 'MATCHING'].includes(trip.status);
  const waitingAtPickup = phase === 'ARRIVED';
  useEffect(() => {
    if (!awaiting && !searching && !waitingAtPickup) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [awaiting, searching, waitingAtPickup]);
  const searchLeft = searching ? Math.max(0, SEARCH_SECONDS - Math.floor((now - new Date(trip.createdAt).getTime()) / 1000)) : null;
  const offeredAt = [...history].reverse().find(h => h.status === 'AWAITING_DRIVER')?.createdAt;
  const remaining = awaiting && offeredAt ? Math.max(0, OFFER_SECONDS - Math.floor((now - new Date(offeredAt).getTime()) / 1000)) : null;
  const expired = remaining === 0;
  const waited = waitingAtPickup && trip.arrivedAt ? Math.max(0, Math.floor((now - new Date(trip.arrivedAt).getTime()) / 1000)) : 0;

  const method = trip.paymentMethod ?? payment?.method ?? 'BANK';
  const cashPending = method === 'CASH' && trip.status === 'PAYMENT_PENDING';
  const discount = Number(trip.discountAmount ?? 0);
  // Tài xế xác nhận đã nhận tiền mặt: Payment chuyển payment sang SUCCESS rồi phát payment.succeeded.
  const collectCash = viewer === 'driver' && cashPending && payment?.status !== 'SUCCESS';
  const failReason = trip.status === 'FAILED' ? [...history].reverse().find(h => h.status === 'FAILED')?.reason : null;
  const rejectedCount = trip.rejectedDriverIds?.length ?? 0;
  const byDriver = trip.status === 'CANCELLED' && trip.cancelledBy === 'DRIVER';
  const hint =
    searching && searchLeft !== null
      ? `${rejectedCount > 0 ? `${rejectedCount} tài xế đã không nhận chuyến, ` : ''}${rejectedCount > 0 ? 'đang' : 'Đang'} tìm tài xế khác gần bạn… (còn ${mmss(searchLeft)})`
      : phase
        ? viewer === 'passenger'
          ? phase === 'ARRIVED'
            ? 'Tài xế đã đến điểm đón. Vui lòng ra gặp tài xế.'
            : TRIP_PHASE[phase].passenger
          : TRIP_PHASE[phase].driver
        : byDriver
          ? viewer === 'passenger'
            ? `Tài xế đã hủy chuyến (${DRIVER_CANCEL_REASON[trip.cancelReason ?? ''] ?? 'không rõ lý do'}).${method === 'BANK' ? ' Tiền tạm giữ đã được hoàn lại vào tài khoản.' : ''}`
            : `Bạn đã hủy chuyến: ${DRIVER_CANCEL_REASON[trip.cancelReason ?? ''] ?? ''}.`
          : failReason === 'NO_AVAILABLE_DRIVERS'
            ? viewer === 'passenger'
              ? 'Rất tiếc, sau 3 phút vẫn chưa tìm được tài xế phù hợp gần bạn. Vui lòng đặt lại sau ít phút hoặc chọn loại xe khác.'
              : 'Chuyến không thành công.'
            : failReason === 'INSUFFICIENT_FUNDS'
              ? viewer === 'passenger'
                ? 'Số dư tài khoản không đủ để thanh toán chuyến này nên chuyến đã bị hủy. Hãy nạp thêm tiền hoặc chọn tiền mặt rồi đặt lại.'
                : 'Chuyến bị hủy vì khách không đủ số dư.'
              : cashPending
                ? viewer === 'passenger'
                  ? `Vui lòng trả ${vnd(trip.fare)} tiền mặt cho tài xế.`
                  : `Thu ${vnd(trip.fare)} tiền mặt của khách rồi bấm "Đã nhận tiền mặt".`
                : HINT[trip.status]?.[viewer];

  const markers: MapMarker[] = [
    { id: 'a', position: trip.pickup, kind: 'pickup', label: 'Điểm đón' },
    { id: 'b', position: trip.destination, kind: 'destination', label: 'Điểm đến' },
    ...(driving && tracking.fix ? [{ id: 'me', position: tracking.fix, kind: 'me' as const, label: 'Vị trí của bạn' }] : []),
    ...(tracked && driverLoc
      ? [{ id: 'driver', position: driverLoc.position, kind: motorbike ? ('bike' as const) : ('car' as const), label: driver ? `${driver.fullName} · ${driver.licensePlate}` : 'Tài xế' }]
      : []),
  ];
  const showNav = driving && !!me;
  const gpsProblem = driving ? gpsErrorMessage(tracking.error) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <div className="space-y-6">
        <div className="h-[320px] overflow-hidden rounded-2xl border border-slate-200 shadow-sm lg:h-[420px]">
          <Map
            center={trip.pickup}
            markers={markers}
            route={showNav ? [me!, navTarget] : tracked ? [driverLoc!.position, passengerTarget] : [trip.pickup, trip.destination]}
            routePath={showNav ? navRoute?.encodedPath : tracked ? driverRoute?.encodedPath : route?.encodedPath}
            fit={showNav ? [me!, navTarget] : tracked ? [driverLoc!.position, passengerTarget] : [trip.pickup, trip.destination]}
          />
        </div>

        {driving && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4">
            <div className="text-sm">
              <div className="font-semibold text-brand-900">{phase === 'ON_BOARD' ? 'Dẫn đường tới điểm trả khách' : 'Dẫn đường tới điểm đón'}</div>
              <div className="text-brand-800">
                {phase === 'ON_BOARD' ? destinationName ?? coord(trip.destination) : pickupName ?? coord(trip.pickup)}
                {navRoute && ` · ${formatDistance(navRoute.distanceMeters)}, khoảng ${formatDuration(navRoute.durationSeconds)}`}
              </div>
              {gpsProblem && <div className="mt-1 text-xs text-amber-700">{gpsProblem}</div>}
            </div>
            <a
              href={mapsUrl(navTarget, motorbike)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <Navigation className="h-4 w-4" /> Mở Google Maps
            </a>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Hành trình</h2>
          <ol className="relative space-y-4 border-l border-slate-200 pl-6">
            {history.map((h, i) => {
              const last = i === history.length - 1;
              return (
                <li key={`${h.status}-${h.createdAt}-${i}`} className="relative">
                  <span className={clsx('absolute -left-[31px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white', last ? 'bg-brand-600' : 'bg-slate-300')}>
                    {last && open && <CircleDot className="h-3 w-3 animate-pulse text-white" />}
                  </span>
                  <div className={clsx('text-sm font-medium', last ? 'text-slate-900' : 'text-slate-600')}>{historyLabel(h)}</div>
                  {h.reason && TRIP_REASON[h.reason] && <div className="text-xs text-slate-500">{TRIP_REASON[h.reason]}</div>}
                  <div className="text-xs text-slate-400">{time(h.createdAt)}</div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <Pill tone={status.tone} pulse={open}>
              {phase ? TRIP_PHASE[phase][viewer] : status.label}
            </Pill>
            {open && <span className="text-xs text-slate-400">Tự cập nhật</span>}
          </div>
          <p
            className={clsx(
              'mt-3 text-sm',
              failReason === 'INSUFFICIENT_FUNDS' || byDriver ? 'font-medium text-red-700' : cashPending || (viewer === 'passenger' && phase === 'ARRIVED') ? 'font-medium text-amber-800' : 'text-slate-600',
            )}
          >
            {hint}
          </p>

          {phase && <PhaseSteps phase={phase} />}

          {tracked && driverLoc && (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                {motorbike ? <Bike className="h-5 w-5" /> : <Car className="h-5 w-5" />}
              </span>
              <div className="min-w-0">
                <div className="font-semibold">
                  {driverLoc.target === 'DESTINATION'
                    ? `Tới điểm đến trong khoảng ${driverLoc.etaMinutes} phút`
                    : phase === 'ARRIVED'
                      ? 'Tài xế đang chờ bạn ở điểm đón'
                      : `Tài xế đến trong khoảng ${driverLoc.etaMinutes} phút`}
                </div>
                <div className="text-xs text-emerald-800">
                  {driverLoc.target === 'DESTINATION' ? 'Còn' : 'Cách điểm đón'} {driverLoc.remainingKm.toLocaleString('vi-VN')} km
                  {driverRoute && ` · lộ trình ${formatDistance(driverRoute.distanceMeters)}`} · vị trí lúc {new Date(driverLoc.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  {driverLoc.stale && ' (tín hiệu GPS của tài xế đã cũ)'}
                </div>
              </div>
            </div>
          )}

          <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm">
            <Place letter="A" color="bg-brand-600" label="Điểm đón" value={pickupName ?? coord(trip.pickup)} />
            <Place letter="B" color="bg-rose-600" label="Điểm đến" value={destinationName ?? coord(trip.destination)} />
            {route && (
              <div className="pl-9 text-xs text-slate-500">
                Lộ trình {formatDistance(route.distanceMeters)} · khoảng {formatDuration(route.durationSeconds)}
              </div>
            )}
            {trip.noteForDriver && (
              <div className={clsx('flex items-start gap-2 rounded-lg px-3 py-2 text-xs', viewer === 'driver' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600')}>
                <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-semibold">{viewer === 'driver' ? 'Ghi chú của khách: ' : 'Ghi chú cho tài xế: '}</span>
                  {trip.noteForDriver}
                </span>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-4">
            <div>
              <div className="text-sm text-slate-500">{viewer === 'driver' ? 'Cước chuyến' : 'Giá cước'}</div>
              <div className="text-2xl font-bold text-slate-900">{vnd(trip.fare)}</div>
              {discount > 0 && (
                <div className="text-xs text-slate-500">
                  <span className="line-through">{vnd(trip.originalFare)}</span> · <span className="font-mono font-semibold text-emerald-700">{trip.voucherCode}</span> −{vnd(discount)}
                </div>
              )}
            </div>
            <div className="text-right text-sm text-slate-500">
              {trip.vehicleType && <div className="font-medium text-slate-700">{VEHICLE[trip.vehicleType] ?? trip.vehicleType}</div>}
              {trip.estimatedDistance} km
            </div>
          </div>
          {trip.pricingSnapshot?.breakdown && (
            <div className="mt-3 space-y-2">
              <PriceReasons snapshot={trip.pricingSnapshot} />
              <PriceBreakdown snapshot={trip.pricingSnapshot} title="Giá đã khóa lúc đặt" />
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            {method === 'CASH' ? <Banknote className="h-4 w-4 text-emerald-600" /> : <Landmark className="h-4 w-4 text-brand-600" />}
            Thanh toán bằng <span className="font-medium text-slate-900">{PAYMENT_METHOD[method]}</span>
          </div>

          {failReason === 'INSUFFICIENT_FUNDS' && viewer === 'passenger' && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> Số dư ngân hàng không đủ
              </div>
              <p className="mt-1">Không khoá được tiền cước nên chuyến chưa được gửi tới tài xế. Nạp thêm tiền hoặc đặt lại bằng tiền mặt.</p>
              <div className="mt-3 flex gap-2">
                <Link href="/khach-hang/ngan-hang" className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                  Nạp tiền
                </Link>
                <Link href="/khach-hang" className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                  Đặt lại
                </Link>
              </div>
            </div>
          )}

          {collectCash && (
            <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <Banknote className="h-4 w-4" /> Thu tiền mặt của khách
              </div>
              <div className="mt-2 text-3xl font-bold text-emerald-900">{vnd(trip.fare)}</div>
              {discount > 0 && <div className="text-xs text-emerald-800">Đã trừ mã {trip.voucherCode} ({vnd(discount)})</div>}
              <button
                type="button"
                onClick={() => void confirmCash()}
                disabled={busy === 'cash'}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy === 'cash' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Đã nhận tiền mặt
              </button>
            </div>
          )}
          {viewer === 'driver' && method === 'BANK' && trip.status === 'PAYMENT_PENDING' && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800">
              <Landmark className="h-4 w-4 shrink-0" /> Khách thanh toán qua ngân hàng, tiền được trừ tự động. Bạn không cần thu tiền.
            </div>
          )}

          {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          <div className="mt-4 flex flex-col gap-2">
            {viewer === 'passenger' && CANCELLABLE.includes(trip.status) && (
              <ActionButton tone="danger" busy={busy === 'cancel'} onClick={() => void act('cancel')} icon={<X className="h-4 w-4" />}>
                Hủy chuyến
              </ActionButton>
            )}
            {awaiting && remaining !== null && (
              <div className={clsx('flex items-center justify-between rounded-xl px-4 py-2.5 text-sm', expired ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-900')}>
                <span>{expired ? 'Cuốc đã hết thời gian xác nhận, đang chuyển cho tài xế khác.' : 'Xác nhận cuốc trong'}</span>
                {!expired && <span className="font-mono text-base font-bold">{remaining}s</span>}
              </div>
            )}
            {awaiting && !expired && (
              <div className="grid grid-cols-2 gap-2">
                <ActionButton tone="secondary" busy={busy === 'reject'} onClick={() => void act('reject')} icon={<X className="h-4 w-4" />}>
                  Từ chối
                </ActionButton>
                <ActionButton tone="primary" busy={busy === 'accept'} onClick={() => void act('accept')} icon={<Check className="h-4 w-4" />}>
                  Nhận cuốc
                </ActionButton>
              </div>
            )}

            {driving && phase === 'TO_PICKUP' && (
              <ActionButton tone="primary" busy={busy === 'arrived'} onClick={() => void act('arrived')} icon={<Flag className="h-4 w-4" />}>
                Đã đến điểm đón
              </ActionButton>
            )}
            {driving && phase === 'ARRIVED' && (
              <>
                <div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                  <span>Đã chờ khách</span>
                  <span className="font-mono text-base font-bold">{mmss(waited)}</span>
                </div>
                <ActionButton tone="primary" busy={busy === 'pickup'} onClick={() => void act('pickup')} icon={<UserCheck className="h-4 w-4" />}>
                  Đã đón khách
                </ActionButton>
              </>
            )}
            {driving && phase === 'ON_BOARD' && (
              <ActionButton tone="primary" busy={busy === 'complete'} onClick={() => void act('complete')} icon={<CheckCheck className="h-4 w-4" />}>
                Hoàn thành chuyến
              </ActionButton>
            )}
            {driving && phase !== 'ON_BOARD' && (
              <button type="button" onClick={() => setCancelOpen(v => !v)} className="text-sm font-medium text-slate-500 underline-offset-2 hover:text-red-600 hover:underline">
                {cancelOpen ? 'Đóng' : 'Không thể thực hiện chuyến?'}
              </button>
            )}
            {driving && cancelOpen && phase !== 'ON_BOARD' && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                <div className="text-xs font-medium text-slate-500">Chọn lý do hủy chuyến</div>
                {(Object.keys(DRIVER_CANCEL_REASON) as DriverCancelReason[]).map(reason => {
                  const noShowLocked = reason === 'PASSENGER_NO_SHOW' && (phase !== 'ARRIVED' || waited < NO_SHOW_SECONDS);
                  return (
                    <button
                      key={reason}
                      type="button"
                      disabled={!!busy || noShowLocked}
                      onClick={() => void driverCancel(reason)}
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2">
                        <Ban className="h-4 w-4 text-red-500" /> {DRIVER_CANCEL_REASON[reason]}
                      </span>
                      {reason === 'PASSENGER_NO_SHOW' && noShowLocked && (
                        <span className="text-xs text-slate-400">{phase !== 'ARRIVED' ? 'bấm "Đã đến" trước' : `sau ${mmss(NO_SHOW_SECONDS - waited)}`}</span>
                      )}
                    </button>
                  );
                })}
                <p className="text-xs text-slate-400">Hủy sau khi đã nhận cuốc được tính vào tỷ lệ hủy chuyến của bạn.</p>
              </div>
            )}
          </div>
        </section>

        {viewer === 'passenger' && driver && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Tài xế của bạn</div>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700">{driver.fullName?.split(' ').slice(-1)[0]?.[0]}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  {driver.fullName}
                  {driverRating?.average != null && (
                    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {driverRating.average.toFixed(1)}
                      <span className="font-normal text-slate-400">({driverRating.count})</span>
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-500">
                  {VEHICLE[driver.vehicleType] ?? driver.vehicleType} · <span className="font-mono font-semibold text-slate-700">{driver.licensePlate}</span>
                </div>
              </div>
              {driver.phone && trip.status === 'IN_PROGRESS' && (
                <a href={`tel:${driver.phone}`} className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700 hover:bg-brand-100" aria-label="Gọi tài xế">
                  <Phone className="h-4 w-4" />
                </a>
              )}
            </div>
          </section>
        )}

        {viewer === 'passenger' && trip.driverId && RATABLE.includes(trip.status) && <RatingPanel tripId={id} />}
        {viewer === 'passenger' && trip.driverId && trip.status === 'CONFIRMED' && <TipPanel tripId={id} driverName={driver?.fullName ?? null} />}

        {viewer === 'driver' && passenger && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Khách hàng</div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-900">{passenger.fullName}</div>
                {trip.status === 'IN_PROGRESS' && <div className="text-sm text-slate-500">{passenger.phone}</div>}
              </div>
              {passenger.phone && trip.status === 'IN_PROGRESS' && (
                <a href={`tel:${passenger.phone}`} className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700 hover:bg-brand-100" aria-label="Gọi khách">
                  <Phone className="h-4 w-4" />
                </a>
              )}
            </div>
          </section>
        )}

        {(trip.status === 'IN_PROGRESS' || trip.status === 'AWAITING_DRIVER') && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShieldAlert className="h-4 w-4 text-red-600" /> Trung tâm an toàn
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-medium">
              <a href="tel:113" className="flex flex-col items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-2 py-3 text-red-700 hover:bg-red-100">
                <Phone className="h-4 w-4" /> Gọi 113
              </a>
              <button type="button" onClick={() => void shareTrip()} className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 px-2 py-3 text-slate-700 hover:bg-slate-50">
                <Share2 className="h-4 w-4" /> Chia sẻ hành trình
              </button>
              <Link href={`${helpHref}?category=SAFETY&trip=${id}`} className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 px-2 py-3 text-slate-700 hover:bg-slate-50">
                <ShieldAlert className="h-4 w-4" /> Báo cáo sự cố
              </Link>
            </div>
            {shared && <p className="mt-2 text-xs text-emerald-700">{shared}</p>}
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
                <span className="flex items-center gap-1.5">
                  <HeartHandshake className="h-3.5 w-3.5" /> Báo cho người thân
                </span>
                <Link href="/tai-khoan#lien-he-khan-cap" className="text-brand-600 hover:underline">
                  Quản lý
                </Link>
              </div>
              {contacts === null ? (
                <p className="text-xs text-slate-400">Đang tải danh sách người thân…</p>
              ) : contacts.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Chưa có liên hệ khẩn cấp.{' '}
                  <Link href="/tai-khoan#lien-he-khan-cap" className="font-medium text-brand-600 hover:underline">
                    Thêm người thân
                  </Link>{' '}
                  để gọi hoặc nhắn hành trình cho họ chỉ với một chạm.
                </p>
              ) : (
                <ul className="space-y-2">
                  {contacts.map(c => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-800">{c.name}</span>
                        <span className="block text-xs text-slate-500">
                          {c.relationship ? `${c.relationship} · ` : ''}
                          {c.phone}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1.5">
                        <a href={`tel:${c.phone}`} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand-700 ring-1 ring-slate-200 hover:bg-brand-50" aria-label={`Gọi ${c.name}`}>
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                        <a
                          href={`sms:${c.phone}?body=${encodeURIComponent(shareText())}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand-700 ring-1 ring-slate-200 hover:bg-brand-50"
                          aria-label={`Nhắn hành trình cho ${c.name}`}
                        >
                          <MessageSquareText className="h-3.5 w-3.5" />
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {payment && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Thanh toán</div>
              <Pill tone={PAYMENT_STATUS[payment.status]?.tone ?? 'gray'}>{PAYMENT_STATUS[payment.status]?.label ?? payment.status}</Pill>
            </div>
            <div className="mt-3 text-2xl font-bold text-slate-900">{vnd(payment.amount)}</div>
            {payment.failureReason && <div className="mt-1 text-sm text-red-600">{FAILURE_REASON[payment.failureReason] ?? payment.failureReason}</div>}
            <div className="mt-1 text-sm text-slate-600">{PAYMENT_METHOD[payment.method ?? method]}{payment.method === 'CASH' && payment.status === 'PENDING' ? ' · chờ tài xế xác nhận đã thu' : ''}</div>
            <div className="mt-2 text-xs text-slate-400">Mã giao dịch {payment.paymentId.slice(0, 8).toUpperCase()} · {time(payment.createdAt)}</div>
          </section>
        )}

        {viewer === 'passenger' && !open && (
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={`/khach-hang?dat-lai=${id}`}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <RotateCcw className="h-4 w-4" /> Đặt lại chuyến này
            </Link>
            <Link
              href={`/khach-hang?dat-lai=${id}&chieu=ve`}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeftRight className="h-4 w-4" /> Đặt chuyến về
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between px-1 text-xs text-slate-400">
          <span>
            Mã chuyến <span className="font-mono">{trip.tripId.slice(0, 8).toUpperCase()}</span> · đặt lúc {time(trip.createdAt)}
          </span>
          {!open && (
            <Link href={`${helpHref}?trip=${id}`} className="font-medium text-brand-600 hover:underline">
              Cần hỗ trợ?
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}

// Tip cho tài xế sau chuyến đã thanh toán: tiền đi từ tài khoản ngân hàng ảo của khách sang ví tài xế.
const TIP_PRESETS = [10000, 20000, 50000];
function TipPanel({ tripId, driverName }: { tripId: string; driverName: string | null }) {
  const [tip, setTip] = useState<TipInfo | null | undefined>(undefined);
  const [amount, setAmount] = useState<number>(TIP_PRESETS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call<TipInfo>(`/payments/trips/${tripId}/tip`).then(r => setTip(r.ok ? r.data : null));
  }, [tripId]);

  async function send() {
    if (!window.confirm(`Tip ${vnd(amount)} cho ${driverName ?? 'tài xế'}? Tiền được trừ từ tài khoản ngân hàng RideFlow của bạn.`)) return;
    setBusy(true);
    setError(null);
    const r = await call<TipInfo>(`/payments/trips/${tripId}/tip`, { body: { amount } });
    setBusy(false);
    if (r.ok) setTip(r.data);
    else setError(r.error);
  }

  if (tip === undefined || tip === null) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        <Gift className="h-3.5 w-3.5" /> Tip cho tài xế
      </div>
      {tip.amount != null ? (
        <p className="mt-3 text-sm text-emerald-700">
          Bạn đã tip <strong>{vnd(tip.amount)}</strong>
          {tip.tippedAt ? ` lúc ${time(tip.tippedAt)}` : ''}. Cảm ơn bạn!
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-slate-600">Tài xế nhận 100% tiền tip, không trừ chiết khấu.</p>
          <div className="grid grid-cols-3 gap-2">
            {TIP_PRESETS.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className={clsx('rounded-xl border py-2 text-sm font-semibold transition', amount === v ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}
              >
                {vnd(v)}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <ActionButton tone="primary" busy={busy} onClick={() => void send()} icon={<Gift className="h-4 w-4" />}>
            Tip {vnd(amount)}
          </ActionButton>
        </div>
      )}
    </section>
  );
}

// Ba bước của chuyến đang chạy: tới điểm đón → đón khách → trả khách.
function PhaseSteps({ phase }: { phase: 'TO_PICKUP' | 'ARRIVED' | 'ON_BOARD' }) {
  const steps = [
    { key: 'TO_PICKUP', label: 'Tới điểm đón' },
    { key: 'ARRIVED', label: 'Đón khách' },
    { key: 'ON_BOARD', label: 'Trả khách' },
  ];
  const current = steps.findIndex(s => s.key === phase);
  return (
    <ol className="mt-4 grid grid-cols-3 gap-2">
      {steps.map((s, i) => (
        <li key={s.key} className="text-center">
          <div className={clsx('h-1.5 rounded-full', i < current ? 'bg-brand-600' : i === current ? 'animate-pulse bg-brand-400' : 'bg-slate-200')} />
          <div className={clsx('mt-1 text-[11px] font-medium', i <= current ? 'text-brand-700' : 'text-slate-400')}>{s.label}</div>
        </li>
      ))}
    </ol>
  );
}

// Khách đánh giá tài xế sau chuyến (mỗi chuyến một lần, lưu ở trip_db).
function RatingPanel({ tripId }: { tripId: string }) {
  const [rating, setRating] = useState<TripRating | null | undefined>(undefined);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call<TripRating | null>(`/trips/${tripId}/rating`).then(r => setRating(r.ok ? r.data : null));
  }, [tripId]);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await call<TripRating>(`/trips/${tripId}/rating`, { body: { stars, tags, comment } });
    setBusy(false);
    if (r.ok) setRating(r.data);
    else setError(r.error);
  }

  if (rating === undefined) return null;
  const visibleTags = Object.entries(RATING_TAG).filter(([, t]) => (stars >= 4 ? t.positive : stars > 0 ? true : t.positive));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Đánh giá tài xế</div>
      {rating ? (
        <div className="mt-3">
          <Stars value={rating.stars} />
          {rating.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rating.tags.map(t => (
                <span key={t} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                  {RATING_TAG[t]?.label ?? t}
                </span>
              ))}
            </div>
          )}
          {rating.comment && <p className="mt-2 text-sm text-slate-600">“{rating.comment}”</p>}
          <p className="mt-2 text-xs text-slate-400">Cảm ơn bạn đã đánh giá!</p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <Stars value={stars} onChange={v => { setStars(v); setTags([]); }} />
          {stars > 0 && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {visibleTags.map(([key, t]) => {
                  const on = tags.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTags(prev => (on ? prev.filter(x => x !== key) : prev.length >= 5 ? prev : [...prev, key]))}
                      className={clsx('rounded-full px-2.5 py-1 text-xs ring-1 transition', on ? (t.positive ? 'bg-emerald-50 text-emerald-700 ring-emerald-300' : 'bg-red-50 text-red-700 ring-red-300') : 'text-slate-600 ring-slate-200 hover:bg-slate-50')}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Nhận xét thêm (không bắt buộc)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <ActionButton tone="primary" busy={busy} onClick={() => void submit()} icon={<Star className="h-4 w-4" />}>
                Gửi đánh giá
              </ActionButton>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-1" role={onChange ? 'radiogroup' : undefined} aria-label="Số sao">
      {[1, 2, 3, 4, 5].map(s => (
        <button
          key={s}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(s)}
          aria-label={`${s} sao`}
          className={clsx('transition', onChange && 'hover:scale-110')}
        >
          <Star className={clsx('h-7 w-7', s <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
        </button>
      ))}
    </div>
  );
}

function Place({ letter, color, label, value }: { letter: string; color: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={clsx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white', color)}>{letter}</span>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="font-medium text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function ActionButton({ tone, busy, onClick, icon, children }: { tone: 'primary' | 'secondary' | 'danger'; busy: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={clsx(
        'flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:opacity-60',
        tone === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        tone === 'secondary' && 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        tone === 'danger' && 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
