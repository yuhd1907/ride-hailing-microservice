import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { time, vnd } from '@/lib/format';
import { coord, TRIP_STATUS, VEHICLE } from '@/lib/labels';
import type { Trip } from '@/lib/types';
import Pill from './Pill';

/** Danh sách chuyến (server component), dữ liệu từ GET /trips/me. */
export default function TripList({ trips, hrefBase }: { trips: Trip[]; hrefBase: string }) {
  return (
    <ul className="divide-y divide-slate-100">
      {trips.map(t => {
        const s = TRIP_STATUS[t.status];
        return (
          <li key={t.tripId}>
            <Link href={`${hrefBase}/${t.tripId}`} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50">
              <div className="w-28 shrink-0 text-sm text-slate-500">{time(t.createdAt)}</div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate text-slate-900">
                  <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[9px] font-bold text-white">A</span>
                  {t.pickup.address ?? coord(t.pickup)}
                </div>
                <div className="mt-1 truncate text-slate-500">
                  <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white">B</span>
                  {t.destination.address ?? coord(t.destination)}
                </div>
              </div>
              <div className="hidden w-28 text-right text-sm text-slate-500 sm:block">
                <div className="font-medium text-slate-700">{t.vehicleType ? VEHICLE[t.vehicleType] ?? t.vehicleType : ''}</div>
                {t.estimatedDistance} km
              </div>
              <div className="w-28 text-right font-semibold text-slate-900">{vnd(t.fare)}</div>
              <div className="hidden w-44 justify-end md:flex">
                <Pill tone={s.tone}>{s.label}</Pill>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
