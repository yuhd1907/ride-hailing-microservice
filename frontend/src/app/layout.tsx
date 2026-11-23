import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'RideFlow — Đặt xe nhanh, giá minh bạch', template: '%s · RideFlow' },
  description: 'Đặt xe máy và ô tô trong vài giây. Giá cước tính trước, theo dõi chuyến theo thời gian thực.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
