import type { Metadata } from 'next';
import Link from 'next/link';
import AuthForm from '@/components/site/AuthForm';

export const metadata: Metadata = { title: 'Đăng nhập' };

export default function LoginPage({ searchParams }: { searchParams: { next?: string; 'het-han'?: string } }) {
  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-900">Đăng nhập</h1>
      <p className="mt-1 text-sm text-slate-500">
        Chưa có tài khoản?{' '}
        <Link href="/dang-ky" className="font-medium text-brand-600 hover:underline">
          Đăng ký
        </Link>
      </p>
      {searchParams['het-han'] && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.</div>
      )}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <AuthForm mode="login" next={searchParams.next} />
      </div>
    </main>
  );
}
