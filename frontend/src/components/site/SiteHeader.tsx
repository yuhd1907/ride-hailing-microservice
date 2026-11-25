import Link from 'next/link';
import { homeOf, type SessionUser } from '@/lib/session';
import Logo from './Logo';
import NotificationBell from './NotificationBell';
import PortalNav from './PortalNav';
import UserMenu from './UserMenu';

const PASSENGER_NAV = [
  { href: '/khach-hang', label: 'Đặt xe', exact: true },
  { href: '/khach-hang/chuyen-di', label: 'Chuyến đi' },
  { href: '/khach-hang/thanh-toan', label: 'Thanh toán' },
  { href: '/khach-hang/ngan-hang', label: 'Ngân hàng' },
  { href: '/khach-hang/thong-bao', label: 'Thông báo' },
  { href: '/khach-hang/tro-giup', label: 'Trợ giúp' },
];

const DRIVER_NAV = [
  { href: '/tai-xe', label: 'Bảng điều khiển', exact: true },
  { href: '/tai-xe/chuyen-di', label: 'Chuyến đã chạy' },
  { href: '/tai-xe/thu-nhap', label: 'Thu nhập' },
  { href: '/tai-xe/vi', label: 'Ví' },
  { href: '/tai-xe/hieu-suat', label: 'Hiệu suất' },
  { href: '/tai-xe/thong-bao', label: 'Thông báo' },
  { href: '/tai-xe/tro-giup', label: 'Trợ giúp' },
  { href: '/tai-xe/phuong-tien', label: 'Phương tiện' },
];

export default function SiteHeader({ user }: { user: SessionUser | null }) {
  const nav = user?.role === 'ROLE_DRIVER' ? DRIVER_NAV : user?.role === 'ROLE_PASSENGER' ? PASSENGER_NAV : null;
  return (
    <header className="sticky top-0 z-[1000] bg-black">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Logo href={user ? homeOf(user.role) : '/'} light />
        {nav ? (
          <PortalNav items={nav} />
        ) : (
          <nav className="hidden flex-1 items-center gap-6 text-sm font-medium text-neutral-300 md:flex">
            <Link href="/#dich-vu" className="hover:text-white">
              Dịch vụ
            </Link>
            <Link href="/#cach-dat-xe" className="hover:text-white">
              Cách đặt xe
            </Link>
            <Link href="/#tai-xe" className="hover:text-white">
              Trở thành tài xế
            </Link>
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3">
          {user?.role && (
            <NotificationBell
              userId={user.userId}
              href={user.role === 'ROLE_DRIVER' ? '/tai-xe/thong-bao' : '/khach-hang/thong-bao'}
              tripHref={user.role === 'ROLE_DRIVER' ? '/tai-xe/chuyen-di' : '/khach-hang/chuyen-di'}
            />
          )}
          {user ? (
            <UserMenu
              name={user.fullName ?? user.email}
              email={user.email}
              roleLabel={user.role === 'ROLE_DRIVER' ? 'Tài xế' : 'Khách hàng'}
            />
          ) : (
            <>
              <Link href="/dang-nhap" className="rounded-full px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
                Đăng nhập
              </Link>
              <Link href="/dang-ky" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200">
                Đăng ký
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
