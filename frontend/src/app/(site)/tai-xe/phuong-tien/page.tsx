import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, ErrorState, PageTitle, Panel } from '@/components/site/Blocks';
import Pill from '@/components/site/Pill';
import VehicleForm from '@/components/site/VehicleForm';
import { time } from '@/lib/format';
import { DRIVER_STATUS, VEHICLE } from '@/lib/labels';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { Driver } from '@/lib/types';

export const metadata: Metadata = { title: 'Phương tiện' };

export default async function VehiclePage() {
  requireUser('ROLE_DRIVER');
  const driver = await gateway<Driver>('/drivers/me');

  if (driver.status === 404) {
    return (
      <Container className="max-w-xl">
        <PageTitle title="Khai báo phương tiện" subtitle="Bước cuối để bắt đầu nhận cuốc. Thông tin này hiển thị cho khách khi bạn nhận chuyến." />
        <Panel>
          <VehicleForm />
        </Panel>
      </Container>
    );
  }

  return (
    <Container className="max-w-xl">
      <PageTitle title="Phương tiện" />
      {!driver.data ? (
        <ErrorState message={driver.error ?? 'Không tải được hồ sơ tài xế.'} />
      ) : (
        <Panel>
          <dl className="grid grid-cols-[140px_1fr] gap-y-4 text-sm">
            <dt className="text-slate-500">Loại xe</dt>
            <dd className="font-medium text-slate-900">{VEHICLE[driver.data.vehicleType] ?? driver.data.vehicleType}</dd>
            <dt className="text-slate-500">Biển số</dt>
            <dd className="font-mono font-semibold text-slate-900">{driver.data.licensePlate}</dd>
            <dt className="text-slate-500">Tài xế</dt>
            <dd className="font-medium text-slate-900">{driver.data.fullName}</dd>
            <dt className="text-slate-500">Điện thoại</dt>
            <dd className="text-slate-900">{driver.data.phone}</dd>
            <dt className="text-slate-500">Trạng thái</dt>
            <dd>
              <Pill tone={DRIVER_STATUS[driver.data.status].tone}>{DRIVER_STATUS[driver.data.status].label}</Pill>
            </dd>
            <dt className="text-slate-500">Đăng ký lúc</dt>
            <dd className="text-slate-900">{time(driver.data.createdAt)}</dd>
          </dl>
          <div className="mt-6 border-t border-slate-100 pt-4">
            <Link href="/tai-xe" className="text-sm font-medium text-brand-600 hover:underline">
              Về bảng điều khiển
            </Link>
          </div>
        </Panel>
      )}
    </Container>
  );
}
