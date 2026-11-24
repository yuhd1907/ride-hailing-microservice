'use client';

import clsx from 'clsx';
import { AlertTriangle, Banknote, Check, CheckCheck, CircleDot, Landmark, Loader2, Phone, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { call } from '@/lib/client';
import { time, vnd } from '@/lib/format';
import { useAddressOf } from '@/lib/geo';
import { CANCELLABLE, coord, FAILURE_REASON, OPEN_TRIP, PAYMENT_METHOD, PAYMENT_STATUS, TRIP_REASON, TRIP_STATUS, VEHICLE } from '@/lib/labels';
import { formatDistance, formatDuration, useRoute } from '@/lib/routes';
import type { Driver, Payment, Trip, TripStatus, UserProfile } from '@/lib/types';
import Map from './Map';
import Pill from './Pill';

export interface HistoryItem {
  previousStatus: TripStatus | null;
  status: TripStatus;
  reason: string | null;
  createdAt: string;
}

type Viewer = 'passenger' | 'driver';

const OFFER_SECONDS = 60; // Driver Service nhả giữ chỗ sau 60 giây; Trip Service chuyển cuốc cho tài xế khác

const HINT: Partial<Record<TripStatus, Record<Viewer, string>>> = {
  REQUESTED: { passenger: 'Đang xác nhận thanh toán…', driver: '' },
  MATCHING: { passenger: 'Hệ thống đang tìm tài xế gần bạn nhất…', driver: '' },
  AWAITING_DRIVER: { passenger: 'Đã tìm thấy tài xế, đang chờ tài xế xác nhận.', driver: 'Bạn có cuốc mới. Xác nhận trong 60 giây, quá hạn cuốc sẽ được chuyển cho tài xế khác.' },
  IN_PROGRESS: { passenger: 'Tài xế đã nhận chuyến. Chúc bạn thượng lộ bình an!', driver: 'Đang chở khách. Bấm "Hoàn thành chuyến" khi đến nơi.' },
  PAYMENT_PENDING: { passenger: 'Chuyến đã kết thúc, đang thanh toán.', driver: 'Đã kết thúc chuyến, đang chờ thanh toán.' },
  CONFIRMED: { passenger: 'Chuyến đi hoàn tất. Cảm ơn bạn đã sử dụng RideFlow!', driver: 'Chuyến đã hoàn tất và được thanh toán.' },
  CANCELLED: { passenger: 'Chuyến đã được hủy.', driver: 'Khách đã hủy chuyến.' },
  FAILED: { passenger: 'Rất tiếc, chưa tìm được tài xế hoặc thanh toán không thành công.', driver: 'Chuyến không thành công.' },
};

export default function TripTracker({ viewer, initialTrip, initialHistory }: { viewer: Viewer; initialTrip: Trip; initialHistory: HistoryItem[] }) {
  const router = useRouter();
  const [trip, setTrip] = useState(initialTrip);
  const [history, setHistory] = useState(initialHistory);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [passenger, setPassenger] = useState<UserProfile | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const id = trip.tripId;
  const open = OPEN_TRIP.includes(trip.status);

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

  // Thông tin bên còn lại của chuyến, lấy từ Driver Service / User Service.
  useEffect(() => {
    if (viewer === 'passenger' && trip.driverId) void call<Driver>(`/drivers/${trip.driverId}`).then(r => r.ok && setDriver(r.data));
    if (viewer === 'passenger' && !trip.driverId) setDriver(null);
    if (viewer === 'driver') void call<UserProfile>(`/users/${trip.passengerId}`).then(r => r.ok && setPassenger(r.data));
  }, [viewer, trip.driverId, trip.passengerId]);

  useEffect(() => {
    if (['PAYMENT_PENDING', 'CONFIRMED', 'FAILED'].includes(trip.status)) {
      void call<Payment>(`/payments/trips/${id}`).then(r => setPayment(r.ok ? r.data : null));
    }
  }, [trip.status, id]);

  // Tài xế xác nhận đã nhận tiền mặt: Payment Service chuyển payment sang SUCCESS rồi phát payment.succeeded.
  async function confirmCash() {
    if (!window.confirm(`Xác nhận đã nhận ${vnd(trip.fare)} tiền mặt từ khách?`)) return;
    setBusy('cash');
    setError(null);
    const r = await call<Payment>(`/payments/trips/${id}/cash-confirm`, { method: 'POST' });
    setBusy(null);
    if (r.ok && r.data) setPayment(r.data);
    else setError(r.status === 404 ? 'Payment Service chưa ghi nhận chuyến này, thử lại sau vài giây.' : r.error);
    await refresh();
    router.refresh();
  }

  async function act(action: 'cancel' | 'accept' | 'reject' | 'complete') {
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
    await refresh();
    router.refresh();
  }

  const { route } = useRoute(trip.pickup, trip.destination);
  const pickupName = useAddressOf(trip.pickup);
  const destinationName = useAddressOf(trip.destination);
  const status = TRIP_STATUS[trip.status];
  const method = trip.paymentMethod ?? 'BANK';
  const discount = Number(trip.discountAmount ?? 0);
  const failedReason = trip.status === 'FAILED' ? [...history].reverse().find(h => h.status === 'FAILED')?.reason ?? null : null;
  const collectCash = viewer === 'driver' && method === 'CASH' && trip.status === 'PAYMENT_PENDING' && payment?.status !== 'SUCCESS';

  // Tài xế có 60 giây để xác nhận cuốc, tính từ lúc chuyến chuyển sang AWAITING_DRIVER (lịch sử trạng thái).
  const [now, setNow] = useState(Date.now());
  const awaiting = viewer === 'driver' && trip.status === 'AWAITING_DRIVER';
  useEffect(() => {
    if (!awaiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [awaiting]);
  const offeredAt = [...history].reverse().find(h => h.status === 'AWAITING_DRIVER')?.createdAt;
  const remaining = awaiting && offeredAt ? Math.max(0, OFFER_SECONDS - Math.floor((now - new Date(offeredAt).getTime()) / 1000)) : null;
  const expired = remaining === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <div className="space-y-6">
        <div className="h-[320px] overflow-hidden rounded-2xl border border-slate-200 shadow-sm lg:h-[420px]">
          <Map
            center={trip.pickup}
            markers={[
              { id: 'a', position: trip.pickup, kind: 'pickup', label: 'Điểm đón' },
              { id: 'b', position: trip.destination, kind: 'destination', label: 'Điểm đến' },
            ]}
            route={[trip.pickup, trip.destination]}
            routePath={route?.encodedPath}
            fit={[trip.pickup, trip.destination]}
          />
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Hành trình</h2>
          <ol className="relative space-y-4 border-l border-slate-200 pl-6">
            {history.map((h, i) => {
              const last = i === history.length - 1;
              return (
                <li key={`${h.status}-${h.createdAt}`} className="relative">
                  <span className={clsx('absolute -left-[31px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white', last ? 'bg-brand-600' : 'bg-slate-300')}>
                    {last && open && <CircleDot className="h-3 w-3 animate-pulse text-white" />}
                  </span>
                  <div className={clsx('text-sm font-medium', last ? 'text-slate-900' : 'text-slate-600')}>{TRIP_STATUS[h.status]?.label ?? h.status}</div>
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
              {status.label}
            </Pill>
            {open && <span className="text-xs text-slate-400">Tự cập nhật</span>}
          </div>
          <p className="mt-3 text-sm text-slate-600">{HINT[trip.status]?.[viewer]}</p>

          <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm">
            <Place letter="A" color="bg-brand-600" label="Điểm đón" value={pickupName ?? coord(trip.pickup)} />
            <Place letter="B" color="bg-rose-600" label="Điểm đến" value={destinationName ?? coord(trip.destination)} />
            {route && (
              <div className="pl-9 text-xs text-slate-500">
                Lộ trình {formatDistance(route.distanceMeters)} · khoảng {formatDuration(route.durationSeconds)}
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
              <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                {method === 'CASH' ? <Banknote className="h-3.5 w-3.5" /> : <Landmark className="h-3.5 w-3.5" />}
                {PAYMENT_METHOD[method]}
              </div>
            </div>
            <div className="text-right text-sm text-slate-500">
              {trip.vehicleType && <div className="font-medium text-slate-700">{VEHICLE[trip.vehicleType] ?? trip.vehicleType}</div>}
              {trip.estimatedDistance} km
            </div>
          </div>

          {failedReason === 'INSUFFICIENT_FUNDS' && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> Số dư ngân hàng không đủ
              </div>
              <p className="mt-1">
                {viewer === 'passenger' ? 'Không khoá được tiền cước nên chuyến chưa được gửi tới tài xế. Nạp thêm tiền hoặc đặt lại bằng tiền mặt.' : 'Khách không đủ số dư, chuyến bị hủy.'}
              </p>
              {viewer === 'passenger' && (
                <div className="mt-3 flex gap-2">
                  <Link href="/khach-hang/ngan-hang" className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                    Nạp tiền
                  </Link>
                  <Link href="/khach-hang" className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                    Đặt lại
                  </Link>
                </div>
              )}
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
          {viewer === 'passenger' && method === 'CASH' && trip.status === 'PAYMENT_PENDING' && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <Banknote className="h-4 w-4 shrink-0" /> Vui lòng trả {vnd(trip.fare)} tiền mặt cho tài xế.
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
            {viewer === 'driver' && trip.status === 'IN_PROGRESS' && (
              <ActionButton tone="primary" busy={busy === 'complete'} onClick={() => void act('complete')} icon={<CheckCheck className="h-4 w-4" />}>
                Hoàn thành chuyến
              </ActionButton>
            )}
          </div>
        </section>

        {viewer === 'passenger' && driver && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Tài xế của bạn</div>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700">{driver.fullName?.split(' ').slice(-1)[0]?.[0]}</span>
              <div className="flex-1">
                <div className="font-semibold text-slate-900">{driver.fullName}</div>
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

        {payment && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Thanh toán</div>
              <Pill tone={PAYMENT_STATUS[payment.status]?.tone ?? 'gray'}>{PAYMENT_STATUS[payment.status]?.label ?? payment.status}</Pill>
            </div>
            <div className="mt-3 text-2xl font-bold text-slate-900">{vnd(payment.amount)}</div>
            {payment.method && <div className="text-sm text-slate-500">{PAYMENT_METHOD[payment.method] ?? payment.method}</div>}
            {payment.failureReason && <div className="mt-1 text-sm text-red-600">{FAILURE_REASON[payment.failureReason] ?? payment.failureReason}</div>}
            <div className="mt-2 text-xs text-slate-400">Mã giao dịch {payment.paymentId.slice(0, 8).toUpperCase()} · {time(payment.createdAt)}</div>
          </section>
        )}

        <div className="px-1 text-xs text-slate-400">
          Mã chuyến <span className="font-mono">{trip.tripId.slice(0, 8).toUpperCase()}</span> · đặt lúc {time(trip.createdAt)}
        </div>
      </aside>
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
