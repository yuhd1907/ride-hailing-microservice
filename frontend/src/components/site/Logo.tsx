import Link from 'next/link';

export default function Logo({ href = '/', light = false }: { href?: string; light?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2" aria-label="RideFlow — trang chủ">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 17h-.5A1.5 1.5 0 0 1 3 15.5V12l2.2-4.4A2 2 0 0 1 7 6.5h10a2 2 0 0 1 1.8 1.1L21 12v3.5a1.5 1.5 0 0 1-1.5 1.5H19" />
          <circle cx="7.5" cy="17" r="2" />
          <circle cx="16.5" cy="17" r="2" />
          <path d="M3.5 12h17" />
        </svg>
      </span>
      <span className={`text-lg font-bold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>
        Ride<span className="text-brand-600">Flow</span>
      </span>
    </Link>
  );
}
