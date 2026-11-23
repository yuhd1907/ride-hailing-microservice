import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Container, ErrorState } from '@/components/site/Blocks';
import DriverDashboard from '@/components/site/DriverDashboard';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { Driver, Trip } from '@/lib/types';

export const metadata: Metadata = { title: 'Bảng điều khiển tài xế' };

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default async function DriverHome() {
  const user = requireUser('ROLE_DRIVER');
  const [driver, trips] = await Promise.all([gateway<Driver>('/drivers/me'), gateway<Trip[]>('/trips/me?limit=100')]);
  // Tài khoản tài xế chưa khai báo phương tiện thì chưa có bản ghi trong driver_db.
  if (driver.status === 404) redirect('/tai-xe/phuong-tien');
  if (!driver.data) {
    return (
      <Container>
        <ErrorState message={driver.error ?? 'Không tải được hồ sơ tài xế.'} />
      </Container>
    );
  }

  const today = (trips.data ?? []).filter(t => t.status === 'CONFIRMED' && new Date(t.updatedAt).getTime() >= startOfToday());
  return (
    <DriverDashboard
      name={user.fullName ?? user.email}
      initialDriver={driver.data}
      todayTrips={today.length}
      todayEarnings={today.reduce((sum, t) => sum + Number(t.fare), 0)}
    />
  );
}
