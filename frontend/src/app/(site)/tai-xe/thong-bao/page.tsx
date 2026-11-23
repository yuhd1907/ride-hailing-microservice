import type { Metadata } from 'next';
import NotificationsPage from '@/components/site/NotificationsPage';
import { requireUser } from '@/lib/server/gateway';

export const metadata: Metadata = { title: 'Thông báo' };

export default function DriverNotifications() {
  requireUser('ROLE_DRIVER');
  return <NotificationsPage tripHref="/tai-xe/chuyen-di" />;
}
