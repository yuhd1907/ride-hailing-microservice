'use client';

import clsx from 'clsx';
import { CalendarDays, ChevronDown, Clock, CloudRain, Info, MapPin, Moon, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react';
import { vnd } from '@/lib/format';
import type { PricingReason, PricingSnapshot } from '@/lib/types';

// Chú thích giá động: đọc thẳng breakdown do Trip Service trả (pricing-policy.js), client không tự tính lại.

const factor = (value: number) => `×${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value)}`;
const number = (value: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);

const REASON_ICON: Record<string, LucideIcon> = {
  NIGHT: Moon,
  MORNING_PEAK: Clock,
  EVENING_PEAK: Clock,
  HIGH_DEMAND: TrendingUp,
  WEEKEND: CalendarDays,
  HOLIDAY: CalendarDays,
  RAIN: CloudRain,
};

const REASON_HINT: Record<string, string> = {
  NIGHT: 'Đặt xe từ 22:00 đến 05:00',
  MORNING_PEAK: 'Giờ cao điểm sáng 07:00–09:00',
  EVENING_PEAK: 'Giờ cao điểm chiều 17:00–19:00',
  HIGH_DEMAND: 'Số người đặt nhiều hơn số tài xế rảnh quanh điểm đón',
  WEEKEND: 'Thứ Bảy, Chủ nhật',
  HOLIDAY: 'Ngày lễ',
  RAIN: 'Trời đang mưa tại điểm đón (Google Weather)',
};

const NOTICE: Record<string, string> = {
  DISTANCE_AND_DURATION_ESTIMATED: 'Không lấy được lộ trình thực tế, quãng đường được ước tính theo đường thẳng.',
};

function noticeText(code: string) {
  if (NOTICE[code]) return NOTICE[code];
  if (code.startsWith('SURGE_')) return 'Chưa đọc được nhu cầu khu vực, giá chưa áp hệ số cao điểm theo nhu cầu.';
  if (code.startsWith('WEATHER_')) return 'Chưa lấy được thời tiết, giá chưa áp phụ thu trời mưa.';
  return code;
}

const reasonValue = (r: PricingReason) => (r.multiplier != null ? factor(r.multiplier) : r.amount != null ? `+${vnd(r.amount)}` : '');

/** Các chip lý do giá thay đổi, ví dụ "Đêm khuya ×1,15", "Trời mưa ×1,1". */
export function PriceReasons({ snapshot, className }: { snapshot: PricingSnapshot | null | undefined; className?: string }) {
  const reasons = snapshot?.breakdown?.reasons;
  if (!reasons) return null;
  return (
    <div className={clsx('flex flex-wrap gap-1.5', className)}>
      {reasons.length === 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          <Sparkles className="h-3.5 w-3.5" /> Giá tiêu chuẩn, không phụ thu
        </span>
      ) : (
        reasons.map(r => {
          const Icon = REASON_ICON[r.code] ?? MapPin;
          return (
            <span
              key={r.code}
              title={REASON_HINT[r.code] ?? r.label}
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
            >
              <Icon className="h-3.5 w-3.5" />
              {r.label} <span className="font-semibold">{reasonValue(r)}</span>
            </span>
          );
        })
      )}
    </div>
  );
}

/** Nhãn nhỏ trên thẻ loại xe khi giá đang cao hơn giá tiêu chuẩn. */
export function SurgeBadge({ snapshot }: { snapshot: PricingSnapshot | null | undefined }) {
  const m = snapshot?.breakdown?.combinedMultiplier;
  if (!m || m <= 1) return null;
  return (
    <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800" title="Hệ số giá động đang áp dụng">
      <TrendingUp className="h-3 w-3" />
      {factor(m)}
    </span>
  );
}

function Row({ label, detail, value, strong, muted }: { label: string; detail?: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3 py-1', strong && 'font-semibold text-slate-900', muted && 'text-slate-500')}>
      <span className="min-w-0">
        {label}
        {detail && <span className="ml-1 text-xs text-slate-400">{detail}</span>}
      </span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

/** Bảng chi tiết: giá gốc → hệ số → tối thiểu → phụ phí → làm tròn → tổng. */
export function PriceBreakdown({
  snapshot,
  defaultOpen = false,
  title = 'Chi tiết giá',
}: {
  snapshot: PricingSnapshot | null | undefined;
  defaultOpen?: boolean;
  title?: string;
}) {
  const b = snapshot?.breakdown;
  if (!snapshot || !b) return null;
  const multiplied = b.subtotal * b.combinedMultiplier;
  const minimumApplied = b.minimumFare > multiplied;
  const factors = b.reasons.filter(r => r.multiplier != null);
  const notices = snapshot.notices ?? [];
  const surge = snapshot.surge;

  return (
    <details open={defaultOpen} className="group rounded-xl border border-slate-200 bg-slate-50/60 text-sm text-slate-700">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          <Info className="h-4 w-4 text-brand-600" /> {title}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-200 px-3 py-2">
        <Row label="Giá mở cửa" value={vnd(b.baseFare)} />
        <Row label="Quãng đường" detail={`${number(snapshot.estimatedDistance)} km × ${vnd(b.perKm)}`} value={vnd(b.distanceFare)} />
        {snapshot.estimatedDuration != null && (
          <Row label="Thời gian" detail={`${number(snapshot.estimatedDuration)} phút × ${vnd(b.perMinute)}`} value={vnd(b.durationFare)} />
        )}
        <div className="my-1 border-t border-dashed border-slate-200" />
        <Row label="Giá gốc" value={vnd(b.subtotal)} strong />

        {factors.length > 0 ? (
          <>
            {factors.map(r => (
              <Row key={r.code} label={r.label} detail={REASON_HINT[r.code]} value={factor(r.multiplier!)} muted />
            ))}
            <Row label="Hệ số giá động" detail={factors.length > 1 ? 'nhân các hệ số trên' : undefined} value={factor(b.combinedMultiplier)} />
            <Row label="Giá sau hệ số" detail={`${vnd(b.subtotal)} ${factor(b.combinedMultiplier)}`} value={vnd(Math.round(multiplied))} />
          </>
        ) : (
          <Row label="Hệ số giá động" detail="không có phụ thu" value="×1" muted />
        )}

        {minimumApplied && <Row label="Áp giá tối thiểu" detail="chuyến quá ngắn" value={vnd(b.minimumFare)} />}
        {b.zoneSurcharge > 0 && (
          <Row label={b.reasons.find(r => r.amount != null)?.label ?? 'Phụ phí khu vực'} detail="phụ phí điểm đón" value={`+${vnd(b.zoneSurcharge)}`} />
        )}
        {Math.round(b.roundingAdjustment) > 0 && <Row label="Làm tròn" detail="lên bội số 1.000 ₫" value={`+${vnd(Math.round(b.roundingAdjustment))}`} muted />}
        <div className="my-1 border-t border-slate-200" />
        <Row label="Tổng cước" value={vnd(snapshot.fareAmount)} strong />

        <div className="mt-2 space-y-1 text-xs text-slate-500">
          {surge?.status === 'available' && (
            <p>
              Quanh điểm đón ({surge.radiusKm ?? 3} km): {surge.availableDrivers ?? 0} tài xế rảnh, {surge.demand ?? 0} yêu cầu đang chờ
              {surge.multiplier > 1 ? ` → hệ số nhu cầu ${factor(surge.multiplier)}.` : ', chưa tính phụ thu theo nhu cầu.'}
            </p>
          )}
          {notices.map(code => (
            <p key={code} className="text-amber-700">
              {noticeText(code)}
            </p>
          ))}
          <p>
            Cách tính: (mở cửa + km × giá/km + phút × giá/phút) × hệ số giờ × nhu cầu × ngày lễ/cuối tuần × thời tiết, không thấp hơn giá tối thiểu, cộng phụ phí khu vực
            rồi làm tròn lên 1.000 ₫. Hệ số theo nhu cầu tối đa ×2.
          </p>
        </div>
      </div>
    </details>
  );
}
