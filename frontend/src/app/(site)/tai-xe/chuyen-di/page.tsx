import type { Metadata } from 'next';
import { Container, EmptyState, ErrorState, PageTitle, Panel } from '@/components/site/Blocks';
import StatusTabs, { TRIP_FILTERS } from '@/components/site/StatusTabs';
import TripList from '@/components/site/TripList';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Chuyến đã chạy' };

export default async function DriverTrips({ searchParams }: { searchParams: { 'trang-thai'?: string } }) {
  requireUser('ROLE_DRIVER');
  const status = TRIP_FILTERS.some(f => f.key === searchParams['trang-thai']) ? searchParams['trang-thai'] ?? '' : '';
  const trips = await gateway<Trip[]>(`/trips/me?limit=100${status ? `&status=${status}` : ''}`);

  return (
    <Container>
      <PageTitle title="Chuyến đã chạy" subtitle="Các cuốc được giao cho bạn, 100 cuốc gần nhất" />
      {trips.error && <ErrorState message={trips.error} />}
      <Panel padded={false}>
        <StatusTabs base="/tai-xe/chuyen-di" active={status} />
        {trips.data && trips.data.length > 0 ? (
          <TripList trips={trips.data} hrefBase="/tai-xe/chuyen-di" />
        ) : (
          <EmptyState title="Chưa có cuốc nào" description="Bật nhận cuốc ở bảng điều khiển để bắt đầu." />
        )}
      </Panel>
    </Container>
  );
}
