import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container, ErrorState } from '@/components/site/Blocks';
import TripTracker, { type HistoryItem } from '@/components/site/TripTracker';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Chi tiết cuốc xe' };

export default async function DriverTripPage({ params }: { params: { id: string } }) {
  requireUser('ROLE_DRIVER');
  // Trip Service chỉ trả chuyến khi tài xế đang được giao chuyến đó; ngược lại 403.
  const [trip, history] = await Promise.all([gateway<Trip>(`/trips/${params.id}`), gateway<HistoryItem[]>(`/trips/${params.id}/history`)]);
  if (trip.status === 400 || trip.status === 403 || trip.status === 404) notFound();

  return (
    <Container>
      <Link href="/tai-xe" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ChevronLeft className="h-4 w-4" /> Bảng điều khiển
      </Link>
      {trip.data ? <TripTracker viewer="driver" initialTrip={trip.data} initialHistory={history.data ?? []} /> : <ErrorState message={trip.error ?? 'Không tải được chuyến.'} />}
    </Container>
  );
}
