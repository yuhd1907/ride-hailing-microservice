import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Không tìm thấy trang</h1>
      <Link href="/" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
        Về trang Tổng quan
      </Link>
    </div>
  );
}
