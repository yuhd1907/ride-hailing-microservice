import Link from 'next/link';

// Wordmark Gogo: chữ "gogo" hình học vẽ bằng nét SVG (không phụ thuộc font máy người dùng).
// Chữ "o" cuối có chấm ở giữa, gợi điểm định vị trên bản đồ; cùng biểu tượng với favicon (src/app/icon.svg).
// Màu theo currentColor: light = chữ trắng trên nền tối (header), mặc định chữ đen.
export function GogoWordmark({ className = 'h-8 w-auto' }: { className?: string }) {
  return (
    <svg viewBox="0 0 109 39" className={className} fill="none" stroke="currentColor" strokeWidth={5} role="img" aria-label="Gogo">
      <circle cx="12.5" cy="14" r="9.5" />
      <path d="M22 2V27.5A9 9 0 0 1 13 36.5H6" />
      <circle cx="40.5" cy="14" r="9.5" />
      <circle cx="68.5" cy="14" r="9.5" />
      <path d="M78 2V27.5A9 9 0 0 1 69 36.5H62" />
      <circle cx="96.5" cy="14" r="9.5" />
      <circle cx="96.5" cy="14" r="3.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function Logo({ href = '/', light = false }: { href?: string; light?: boolean }) {
  return (
    <Link href={href} className={`flex items-center ${light ? 'text-white' : 'text-black'}`} aria-label="Gogo — trang chủ">
      <GogoWordmark />
    </Link>
  );
}
