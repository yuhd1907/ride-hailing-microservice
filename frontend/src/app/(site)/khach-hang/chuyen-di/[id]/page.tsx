import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container, ErrorState } from '@/components/site/Blocks';
import TripTracker, { type HistoryItem } from '@/components/site/TripTracker';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Chi tiết chuyến đi' };

export default async function PassengerTripPage({ params }: { params: { id: string } }) {
  requireUser('ROLE_PASSENGER');
  const [trip, history] = await Promise.all([gateway<Trip>(`/trips/${params.id}`), gateway<HistoryItem[]>(`/trips/${params.id}/history`)]);
  if (trip.status === 400 || trip.status === 403 || trip.status === 404) notFound();

  return (
    <Container>
      <Link href="/khach-hang/chuyen-di" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ChevronLeft className="h-4 w-4" /> Chuyến đi của tôi
      </Link>
      {trip.data ? <TripTracker viewer="passenger" initialTrip={trip.data} initialHistory={history.data ?? []} /> : <ErrorState message={trip.error ?? 'Không tải được chuyến đi.'} />}
    </Container>
  );
}
