import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, EmptyState, ErrorState, PageTitle, Panel } from '@/components/site/Blocks';
import StatusTabs, { TRIP_FILTERS } from '@/components/site/StatusTabs';
import TripList from '@/components/site/TripList';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Chuyến đi của tôi' };

export default async function PassengerTrips({ searchParams }: { searchParams: { 'trang-thai'?: string } }) {
  requireUser('ROLE_PASSENGER');
  const status = TRIP_FILTERS.some(f => f.key === searchParams['trang-thai']) ? searchParams['trang-thai'] ?? '' : '';
  const trips = await gateway<Trip[]>(`/trips/me?limit=100${status ? `&status=${status}` : ''}`);

  return (
    <Container>
      <PageTitle title="Chuyến đi của tôi" subtitle="100 chuyến gần nhất" />
      {trips.error && <ErrorState message={trips.error} />}
      <Panel padded={false}>
        <StatusTabs base="/khach-hang/chuyen-di" active={status} />
        {trips.data && trips.data.length > 0 ? (
          <TripList trips={trips.data} hrefBase="/khach-hang/chuyen-di" />
        ) : (
          <EmptyState
            title="Chưa có chuyến đi nào"
            description="Các chuyến bạn đặt sẽ xuất hiện ở đây."
            action={
              <Link href="/khach-hang" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Đặt xe
              </Link>
            }
          />
        )}
      </Panel>
    </Container>
  );
}
