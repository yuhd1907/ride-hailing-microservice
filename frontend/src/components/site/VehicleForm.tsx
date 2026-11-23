'use client';

import clsx from 'clsx';
import { Bike, Car, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { call } from '@/lib/client';
import type { Driver } from '@/lib/types';

const TYPES = [
  { value: 'MOTORCYCLE', label: 'Xe máy', icon: Bike },
  { value: 'CAR_4_SEAT', label: 'Ô tô 4 chỗ', icon: Car },
  { value: 'CAR_7_SEAT', label: 'Ô tô 7 chỗ', icon: Car },
];

export default function VehicleForm() {
  const [vehicleType, setVehicleType] = useState('MOTORCYCLE');
  const [licensePlate, setLicensePlate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-5"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await call<Driver>('/drivers', { body: { vehicleType, licensePlate: licensePlate.trim().toUpperCase() } });
        if (r.ok) window.location.href = '/tai-xe';
        else {
          setError(r.error);
          setBusy(false);
        }
      }}
    >
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Loại xe</div>
        <div className="grid grid-cols-3 gap-3">
          {TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setVehicleType(t.value)}
              className={clsx(
                'flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition',
                vehicleType === t.value ? 'border-brand-500 bg-brand-50 text-brand-700 ring-4 ring-brand-100' : 'border-slate-200 text-slate-600 hover:border-slate-300',
              )}
            >
              <t.icon className="h-6 w-6" />
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Biển số xe</span>
        <input
          value={licensePlate}
          onChange={e => setLicensePlate(e.target.value)}
          required
          minLength={3}
          maxLength={20}
          pattern="[A-Za-z0-9.\-]{3,20}"
          title="3–20 ký tự: chữ, số, dấu chấm hoặc gạch ngang"
          placeholder="29A-123.45"
          className="h-11 w-full rounded-xl border border-slate-300 px-3.5 font-mono text-sm uppercase focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
        />
      </label>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <button type="submit" disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Hoàn tất đăng ký
      </button>
    </form>
  );
}
