import { Facebook, Instagram, Youtube } from 'lucide-react';
import Link from 'next/link';
import type { SVGProps } from 'react';
import type { SessionUser } from '@/lib/session';
import Logo from './Logo';

// lucide-react không có icon TikTok: nốt nhạc có cờ, nét đặc.
function TikTok(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M14 3h3a4 4 0 0 0 4 4v3a7 7 0 0 1-4-1.3V15a6 6 0 1 1-6-6v3.2A2.8 2.8 0 1 0 14 15Z" />
    </svg>
  );
}

// Đường dẫn trang mạng xã hội: thay '#' bằng địa chỉ trang thật khi có.
const SOCIAL = [
  { label: 'Facebook', href: '#', icon: Facebook },
  { label: 'Instagram', href: '#', icon: Instagram },
  { label: 'YouTube', href: '#', icon: Youtube },
  { label: 'TikTok', href: '#', icon: TikTok },
];

export default function Footer({ user }: { user: SessionUser | null }) {
  const driver = user?.role === 'ROLE_DRIVER';
  // Trang trợ giúp tách theo vai trò; khách chưa đăng nhập được đưa qua đăng nhập rồi quay lại.
  const help = driver ? '/tai-xe/tro-giup' : '/khach-hang/tro-giup';
  const columns = [
    {
      title: 'Dịch vụ',
      links: [
        { label: 'Xe máy', href: '/#dich-vu' },
        { label: 'Ô tô 4 chỗ', href: '/#dich-vu' },
        { label: 'Ô tô 7 chỗ', href: '/#dich-vu' },
        { label: 'Cách đặt xe', href: '/#cach-dat-xe' },
      ],
    },
    {
      title: 'Tài xế',
      links: [
        { label: 'Trở thành tài xế', href: '/dang-ky?vai-tro=tai-xe' },
        { label: 'Thu nhập và ví', href: '/tai-xe/thu-nhap' },
        { label: 'Trợ giúp tài xế', href: '/tai-xe/tro-giup' },
      ],
    },
    {
      title: 'Hỗ trợ',
      links: [
        { label: 'Trung tâm trợ giúp', href: help },
        { label: 'An toàn khi đi xe', href: help },
        { label: 'Tài khoản của tôi', href: '/tai-khoan' },
      ],
    },
  ];

  return (
    <footer className="bg-black text-neutral-400">
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Logo light />
            <p className="mt-5 max-w-sm text-sm leading-6">
              Gogo giúp bạn đặt xe máy và ô tô trong vài giây, biết giá trước khi đi. Tài xế được xác thực, chuyến đi được theo dõi theo thời
              gian thực và thanh toán tự động khi kết thúc.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map(col => (
              <div key={col.title}>
                <h3 className="text-sm font-semibold text-white">{col.title}</h3>
                <ul className="mt-4 space-y-3 text-sm">
                  {col.links.map(link => (
                    <li key={link.label}>
                      <Link href={link.href} className="hover:text-white">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-6 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex items-center gap-2">
            {SOCIAL.map(({ label, href, icon: Icon }) => (
              <li key={label}>
                <a
                  href={href}
                  aria-label={label}
                  title={label}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Icon className="h-5 w-5" />
                </a>
              </li>
            ))}
          </ul>
          <p className="text-xs">© {new Date().getFullYear()} Gogo. Bảo lưu mọi quyền.</p>
        </div>
      </div>
    </footer>
  );
}
