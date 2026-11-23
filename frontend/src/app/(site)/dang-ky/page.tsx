import type { Metadata } from 'next';
import Link from 'next/link';
import AuthForm from '@/components/site/AuthForm';

export const metadata: Metadata = { title: 'Đăng ký' };

export default function RegisterPage({ searchParams }: { searchParams: { 'vai-tro'?: string } }) {
  return (
    <main className="mx-auto flex max-w-lg flex-col px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-900">Tạo tài khoản</h1>
      <p className="mt-1 text-sm text-slate-500">
        Đã có tài khoản?{' '}
        <Link href="/dang-nhap" className="font-medium text-brand-600 hover:underline">
          Đăng nhập
        </Link>
      </p>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <AuthForm mode="register" defaultRole={searchParams['vai-tro'] === 'tai-xe' ? 'ROLE_DRIVER' : 'ROLE_PASSENGER'} />
      </div>
    </main>
  );
}
