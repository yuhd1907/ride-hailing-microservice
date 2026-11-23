'use client';

import { Field, Input, Select } from './ui';
import { PLACES } from '@/lib/places';
import type { Point } from '@/lib/types';

export default function PointInput({ label, value, onChange }: { label: string; value: Point; onChange: (p: Point) => void }) {
  const preset = PLACES.findIndex(p => p.point.lat === value.lat && p.point.lng === value.lng);
  return (
    <div className="space-y-2">
      <Field label={label}>
        <Select
          value={preset}
          onChange={e => {
            const place = PLACES[Number(e.target.value)];
            if (place) onChange(place.point);
          }}
        >
          <option value={-1}>Tọa độ tự nhập</option>
          {PLACES.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          step="0.0001"
          value={value.lat}
          onChange={e => onChange({ ...value, lat: Number(e.target.value) })}
          aria-label={`${label} - vĩ độ`}
          placeholder="Vĩ độ"
        />
        <Input
          type="number"
          step="0.0001"
          value={value.lng}
          onChange={e => onChange({ ...value, lng: Number(e.target.value) })}
          aria-label={`${label} - kinh độ`}
          placeholder="Kinh độ"
        />
      </div>
    </div>
  );
}
