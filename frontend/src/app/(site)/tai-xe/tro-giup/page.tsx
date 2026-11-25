import type { Metadata } from 'next';
import { Container, ErrorState, PageTitle } from '@/components/site/Blocks';
import HelpCenter from '@/components/site/HelpCenter';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { SupportTicket, Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Trung tâm trợ giúp' };

export default async function DriverHelp({ searchParams }: { searchParams: { category?: string; trip?: string } }) {
  requireUser('ROLE_DRIVER');
  const [tickets, trips] = await Promise.all([gateway<SupportTicket[]>('/trips/support/tickets'), gateway<Trip[]>('/trips/me?limit=20')]);
  return (
    <Container>
      <PageTitle title="Trung tâm trợ giúp" subtitle="Tra cứu câu hỏi thường gặp, gửi khiếu nại về khách bom chuyến, sai định vị, tính sai cước, ví và rút tiền" />
      {tickets.error && <ErrorState message={tickets.error} />}
      <HelpCenter role="DRIVER" initialTickets={tickets.data ?? []} recentTrips={trips.data ?? []} initialCategory={searchParams.category} initialTripId={searchParams.trip} tripHref="/tai-xe/chuyen-di" />
    </Container>
  );
}
