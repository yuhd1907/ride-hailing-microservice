import type { Metadata } from 'next';
import NotificationsPage from '@/components/site/NotificationsPage';
import { requireUser } from '@/lib/server/gateway';

export const metadata: Metadata = { title: 'Thông báo' };

export default function PassengerNotifications() {
  requireUser('ROLE_PASSENGER');
  return <NotificationsPage tripHref="/khach-hang/chuyen-di" />;
}
