import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { Tone } from '@/lib/labels';

const TONES: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-50 text-blue-700',
  amber: 'bg-amber-50 text-amber-800',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-700',
  violet: 'bg-violet-50 text-violet-700',
};

const DOTS: Record<Tone, string> = {
  gray: 'bg-slate-400',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  red: 'bg-red-500',
  violet: 'bg-violet-500',
};

export default function Pill({ tone = 'gray', children, pulse }: { tone?: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', TONES[tone])}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', DOTS[tone], pulse && 'animate-pulse')} />
      {children}
    </span>
  );
}
