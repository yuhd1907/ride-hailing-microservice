'use client';

import clsx from 'clsx';
import { ArrowRight, Banknote, Bike, Car, Hand, Landmark, Loader2, MessageSquareText, Navigation, RefreshCw, Route, Ticket, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { call } from '@/lib/client';
import { vnd } from '@/lib/format';
import { FALLBACK_CENTER, useBrowserLocation, useReverseGeocoder } from '@/lib/geo';
import { TRIP_STATUS, VEHICLE, VOUCHER_REASON } from '@/lib/labels';
import { formatDistance, formatDuration, useRoute } from '@/lib/routes';
import type { BankAccount, Driver, FareEstimate, FareRate, PaymentMethod, Point, Trip, VehicleType, Voucher } from '@/lib/types';
import AddressInput from './AddressInput';
import Map, { type MapMarker } from './Map';
import Pill from './Pill';
import { PriceBreakdown, PriceReasons, SurgeBadge } from './PriceBreakdown';

const SEARCH_RADIUS_KM = 5;

export default function BookingClient({
  firstName,
  activeTrip,
  rates,
  loadError,
  initialPickup = null,
  initialDestination = null,
  initialVehicleType = null,
}: {
  firstName: string;
  activeTrip: Trip | null;
  rates: FareRate[];
  loadError: string | null;
  /** "Đặt lại chuyến": điểm đón/đến và loại xe của chuyến cũ. */
  initialPickup?: Point | null;
  initialDestination?: Point | null;
  initialVehicleType?: VehicleType | null;
}) {
  const [vehicleType, setVehicleType] = useState<VehicleType>(initialVehicleType ?? rates[0]?.vehicleType ?? 'MOTORCYCLE');
  const router = useRouter();
  // Không tự lấy GPS: khách nhập địa chỉ trước, chỉ định vị khi bấm "Vị trí của tôi".
  const { location, status: geoStatus, locate } = useBrowserLocation(false);
  const reverse = useReverseGeocoder();
  const [pickup, setPickup] = useState<Point | null>(initialPickup);
  const [destination, setDestination] = useState<Point | null>(initialDestination);
  const [note, setNote] = useState('');
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [estimate, setEstimate] = useState<FareEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('BANK');
  const [voucherCode, setVoucherCode] = useState<string | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[] | null>(null);
  const [bank, setBank] = useState<BankAccount | null>(null);
  const [toppingUp, setToppingUp] = useState<number | null>(null);
  const [quoteRound, setQuoteRound] = useState(0);

  // Voucher còn dùng được (Trip Service) và số dư khả dụng của ngân hàng ảo (Payment Service).
  const loadWallet = useCallback(async () => {
    const [v, b] = await Promise.all([call<Voucher[]>('/trips/vouchers'), call<BankAccount>('/payments/bank/me')]);
    setVouchers(v.ok ? v.data ?? [] : []);
    setBank(b.ok ? b.data : null);
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  // Nạp nhanh khi số dư không đủ, không phải rời trang đặt xe.
  async function topUp(amount: number) {
    setToppingUp(amount);
    const r = await call<BankAccount>('/payments/bank/me/topup', { body: { amount } });
    setToppingUp(null);
    if (r.ok) setBank(r.data);
    else setError(r.error);
  }

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

  // Báo giá có hiệu lực 120 giây: tự báo giá lại mỗi 90 giây để quoteId gửi khi đặt luôn còn hạn.
  useEffect(() => {
    if (!pickup || !destination) return;
    const id = window.setInterval(() => setQuoteRound(n => n + 1), 90_000);
    return () => window.clearInterval(id);
  }, [pickup, destination]);

  // Đổi điểm đón/đến hoặc mã giảm giá thì bỏ giá cũ; lần báo giá lại định kỳ vẫn giữ giá đang hiển thị.
  useEffect(() => {
    setEstimate(null);
  }, [pickup, destination, voucherCode]);

  // Giá cước do Trip Service tính (giá động); client không tự tính.
  useEffect(() => {
    if (!pickup || !destination) return;
    let cancelled = false;
    setEstimating(true);
    call<FareEstimate>('/trips/estimate', { body: { pickup, destination, voucherCode: voucherCode ?? undefined } }).then(r => {
      if (cancelled) return;
      setEstimating(false);
      if (r.ok) setEstimate(r.data);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [pickup, destination, voucherCode, quoteRound]);

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
    if (!pickup || !destination || !chosen || shortOfFunds) return;
    setBooking(true);
    setError(null);
    // Gửi quoteId để khóa đúng giá khách đang thấy (voucher được trừ trên giá đã khóa).
    const r = await call<Trip>('/trips', { body: { quoteId: chosen.quoteId, pickup, destination, vehicleType, paymentMethod, voucherCode: voucherCode ?? undefined, note: note.trim() || undefined } });
    if (r.ok && r.data) {
      router.push(`/khach-hang/chuyen-di/${r.data.tripId}`);
      router.refresh();
      return;
    }
    setError(r.error);
    setBooking(false);
    void loadWallet();
    // Báo giá hết hạn / thay đổi: lấy giá mới để khách xem lại trước khi đặt.
    if (r.status === 409) setQuoteRound(n => n + 1);
  }

  // Danh sách loại xe lấy từ bảng giá; nếu lần tải bảng giá lỗi thì dựng lại từ báo giá (cũng do server trả).
  const vehicles: FareRate[] = rates.length
    ? rates
    : (estimate?.options ?? []).map(o => ({ vehicleType: o.vehicleType, displayName: o.displayName, seats: o.seats, baseFare: 0, perKm: 0 }));

  const { route, loading: routing } = useRoute(pickup, destination);
  // Báo giá của loại xe đang chọn (Trip Service trả giá của mọi loại xe trong một lần gọi).
  const chosen = estimate?.options?.find(o => o.vehicleType === vehicleType) ?? null;
  const selectedNearby = drivers?.filter(d => d.vehicleType === vehicleType) ?? null;
  const voucherBlocked = !!voucherCode && chosen?.voucherApplicable === false;
  // Trả bằng ngân hàng thì số dư khả dụng phải đủ giá cước; Payment cũng kiểm tra lại khi khóa tiền.
  const shortfall = paymentMethod === 'BANK' && bank && chosen ? Math.max(0, Number(chosen.fareAmount) - Number(bank.available)) : 0;
  const shortOfFunds = shortfall > 0;

  // Tài xế rảnh quanh điểm đón (Driver Service trả kèm vị trí GPS gần nhất): xe máy / ô tô trên bản đồ.
  const nearbyMarkers: MapMarker[] = (drivers ?? []).flatMap(d =>
    d.latitude != null && d.longitude != null
      ? [
          {
            id: `driver-${d.id}`,
            position: { lat: d.latitude, lng: d.longitude },
            kind: d.vehicleType === 'MOTORCYCLE' ? ('bike' as const) : ('car' as const),
            label: `${VEHICLE[d.vehicleType] ?? d.vehicleType} · ${d.licensePlate}${d.distance != null ? ` · cách ${d.distance.toFixed(1)} km` : ''}`,
          },
        ]
      : [],
  );
  const markers: MapMarker[] = [
    ...nearbyMarkers,
    ...(pickup ? [{ id: 'pickup', position: pickup, kind: 'pickup' as const, label: pickup.address ?? 'Điểm đón', draggable: true }] : []),
    ...(destination ? [{ id: 'destination', position: destination, kind: 'destination' as const, label: destination.address ?? 'Điểm đến', draggable: true }] : []),
  ];
  // Mới có điểm đón: thu bản đồ vừa điểm đón và các tài xế đúng loại xe đang chọn để khách thấy xe quanh mình.
  const fitPoints =
    pickup && !destination
      ? [pickup, ...nearbyMarkers.filter(m => (vehicleType === 'MOTORCYCLE') === (m.kind === 'bike')).map(m => m.position)]
      : ([pickup, destination].filter(Boolean) as Point[]);

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
            {vehicles.map(rate => {
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
                      <>
                        <span className="block text-base font-bold text-slate-900">{vnd(option.fareAmount)}</span>
                        {!!option.discountAmount && <span className="block text-xs text-slate-400 line-through">{vnd(option.originalFare)}</span>}
                        <SurgeBadge snapshot={option} />
                      </>
                    ) : (
                      <span className="block text-xs text-slate-400">—</span>
                    )}
                  </span>
                </button>
              );
            })}
            {vehicles.length === 0 && <p className="px-1 text-sm text-slate-500">Chưa tải được bảng giá.</p>}
          </div>
          {chosen && (
            <div className="mt-3 space-y-2">
              <PriceReasons snapshot={chosen} />
              <PriceBreakdown snapshot={{ ...chosen, fareAmount: chosen.originalFare ?? chosen.fareAmount }} title={`Vì sao giá ${vnd(chosen.originalFare ?? chosen.fareAmount)}?`} />
              <div className="px-1 text-xs text-slate-500">Giá được giữ nguyên khi bạn bấm đặt, kể cả nếu hệ số thay đổi sau đó.</div>
            </div>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-2 px-1 text-sm font-semibold text-slate-900">Thanh toán</div>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Phương thức thanh toán">
              <MethodButton
                selected={paymentMethod === 'BANK'}
                onClick={() => setPaymentMethod('BANK')}
                icon={<Landmark className="h-4 w-4" />}
                title="Ngân hàng"
                detail={bank ? `Khả dụng ${vnd(bank.available)}` : 'Trừ tự động khi kết thúc'}
              />
              <MethodButton selected={paymentMethod === 'CASH'} onClick={() => setPaymentMethod('CASH')} icon={<Banknote className="h-4 w-4" />} title="Tiền mặt" detail="Trả tài xế khi đến nơi" />
            </div>
            {shortOfFunds && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div className="font-semibold">Số dư ngân hàng không đủ</div>
                <div className="mt-0.5">
                  Khả dụng {vnd(bank?.available)}, chuyến này cần {vnd(chosen?.fareAmount)} (thiếu {vnd(shortfall)}). Nạp thêm tiền hoặc chọn thanh toán tiền mặt.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[Math.ceil(shortfall / 10000) * 10000, 200000, 500000]
                    .filter((v, i, all) => all.indexOf(v) === i && v >= 1000 && v <= 5000000)
                    .map(amount => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => void topUp(amount)}
                        disabled={toppingUp !== null}
                        className="flex items-center gap-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                      >
                        {toppingUp === amount && <Loader2 className="h-3 w-3 animate-spin" />}
                        Nạp {vnd(amount)}
                      </button>
                    ))}
                  <button type="button" onClick={() => setPaymentMethod('CASH')} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-700 underline">
                    Dùng tiền mặt
                  </button>
                  <Link href="/khach-hang/ngan-hang" className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-700 underline">
                    Mở ngân hàng
                  </Link>
                </div>
              </div>
            )}
            {paymentMethod === 'BANK' && bank && !shortOfFunds && chosen && (
              <p className="mt-2 px-1 text-xs text-slate-500">Khi đặt, {vnd(chosen.fareAmount)} được khóa trong tài khoản và chỉ trừ khi chuyến hoàn thành; hủy chuyến sẽ mở khóa lại.</p>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between px-1 text-sm">
              <span className="font-semibold text-slate-900">Mã giảm giá</span>
              {voucherCode && (
                <button type="button" onClick={() => setVoucherCode(null)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                  <X className="h-3.5 w-3.5" /> Bỏ chọn
                </button>
              )}
            </div>
            {vouchers === null ? (
              <p className="px-1 text-xs text-slate-400">Đang tải mã giảm giá…</p>
            ) : vouchers.length === 0 ? (
              <p className="px-1 text-xs text-slate-500">Bạn chưa có mã giảm giá nào dùng được.</p>
            ) : (
              <div className="space-y-2" role="radiogroup" aria-label="Mã giảm giá">
                {vouchers.map(v => {
                  const selected = voucherCode === v.code;
                  return (
                    <button
                      key={v.code}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setVoucherCode(selected ? null : v.code)}
                      className={clsx(
                        'flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-left transition',
                        selected ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      <Ticket className={clsx('h-4 w-4 shrink-0', selected ? 'text-emerald-600' : 'text-slate-400')} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-sm font-semibold text-slate-900">{v.code}</span>
                        <span className="block truncate text-xs text-slate-500">{v.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {voucherCode && chosen && (
              <p className={clsx('mt-2 px-1 text-xs', chosen.voucherApplicable ? 'text-emerald-700' : 'text-amber-700')}>
                {chosen.voucherApplicable
                  ? `Giảm ${vnd(chosen.discountAmount)}: ${vnd(chosen.originalFare)} → ${vnd(chosen.fareAmount)}`
                  : `${VOUCHER_REASON[chosen.voucherReason ?? ''] ?? 'Mã không áp dụng được'}. Chọn loại xe khác hoặc bỏ mã.`}
              </p>
            )}
          </div>

          <div className="mt-4">
            <label htmlFor="note-for-driver" className="mb-2 flex items-center justify-between px-1 text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                <MessageSquareText className="h-4 w-4 text-slate-400" /> Ghi chú cho tài xế
              </span>
              <span className="text-xs text-slate-400">{note.length}/200</span>
            </label>
            <textarea
              id="note-for-driver"
              value={note}
              onChange={e => setNote(e.target.value.slice(0, 200))}
              rows={2}
              placeholder="Ví dụ: đứng ở cổng số 2, mặc áo xanh"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <button
            type="button"
            onClick={() => void book()}
            disabled={!chosen || booking || !!activeTrip || voucherBlocked || shortOfFunds}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
            {activeTrip
              ? 'Hoàn tất chuyến hiện tại trước'
              : !pickup || !destination
                ? 'Nhập đủ điểm đón và điểm đến'
                : voucherBlocked
                  ? 'Mã giảm giá không dùng được'
                  : shortOfFunds
                    ? 'Số dư không đủ để đặt'
                    : chosen
                    ? `Đặt ${vehicles.find(r => r.vehicleType === vehicleType)?.displayName.toLowerCase() ?? 'xe'} · ${vnd(chosen.fareAmount)} · ${paymentMethod === 'CASH' ? 'tiền mặt' : 'ngân hàng'}`
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

function MethodButton({ selected, onClick, icon, title, detail }: { selected: boolean; onClick: () => void; icon: ReactNode; title: string; detail: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={clsx(
        'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition',
        selected ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      <span className={clsx('flex items-center gap-1.5 text-sm font-semibold', selected ? 'text-brand-700' : 'text-slate-900')}>
        {icon}
        {title}
      </span>
      <span className="text-xs text-slate-500">{detail}</span>
    </button>
  );
}
