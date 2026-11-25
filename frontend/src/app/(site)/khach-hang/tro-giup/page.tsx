import type { Metadata } from 'next';
import { Container, ErrorState, PageTitle } from '@/components/site/Blocks';
import HelpCenter from '@/components/site/HelpCenter';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { SupportTicket, Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Trung tâm trợ giúp' };

export default async function PassengerHelp({ searchParams }: { searchParams: { category?: string; trip?: string } }) {
  requireUser('ROLE_PASSENGER');
  const [tickets, trips] = await Promise.all([gateway<SupportTicket[]>('/trips/support/tickets'), gateway<Trip[]>('/trips/me?limit=20')]);
  return (
    <Container>
      <PageTitle title="Trung tâm trợ giúp" subtitle="Câu hỏi thường gặp và gửi phản ánh về chuyến đi, cước phí, thanh toán, an toàn" />
      {tickets.error && <ErrorState message={tickets.error} />}
      <HelpCenter role="PASSENGER" initialTickets={tickets.data ?? []} recentTrips={trips.data ?? []} initialCategory={searchParams.category} initialTripId={searchParams.trip} tripHref="/khach-hang/chuyen-di" />
    </Container>
  );
}
