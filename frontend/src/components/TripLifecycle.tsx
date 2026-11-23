import clsx from 'clsx';
import type { TripStatus } from '@/lib/types';

const STEPS: { status: TripStatus; label: string }[] = [
  { status: 'REQUESTED', label: 'Đã đặt' },
  { status: 'MATCHING', label: 'Đang ghép' },
  { status: 'AWAITING_DRIVER', label: 'Chờ tài xế nhận' },
  { status: 'IN_PROGRESS', label: 'Đang chạy' },
  { status: 'PAYMENT_PENDING', label: 'Chờ thanh toán' },
  { status: 'CONFIRMED', label: 'Hoàn tất' },
];

const TERMINAL_FAIL: TripStatus[] = ['CANCELLED', 'FAILED'];

/** Thanh tiến trình vòng đời chuyến; CANCELLED/FAILED hiển thị riêng. */
export default function TripLifecycle({ status }: { status: TripStatus }) {
  if (TERMINAL_FAIL.includes(status)) {
    return (
      <div className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
        Chuyến kết thúc ở trạng thái {status === 'CANCELLED' ? 'ĐÃ HỦY' : 'THẤT BẠI (không ghép được tài xế hoặc thanh toán lỗi)'}
      </div>
    );
  }
  const current = Math.max(
    0,
    STEPS.findIndex(s => s.status === (status === 'COMPLETED' ? 'CONFIRMED' : status)),
  );
  return (
    <ol className="flex items-center gap-1">
      {STEPS.map((step, i) => (
        <li key={step.status} className="flex flex-1 flex-col items-center gap-1">
          <div className={clsx('h-1.5 w-full rounded-full', i <= current ? 'bg-brand-600' : 'bg-slate-200')} />
          <span className={clsx('text-center text-[10.5px] leading-tight', i === current ? 'font-semibold text-brand-700' : 'text-slate-400')}>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
