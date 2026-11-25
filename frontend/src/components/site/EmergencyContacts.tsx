'use client';

import { Loader2, Phone, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { call } from '@/lib/client';
import type { EmergencyContact } from '@/lib/types';

const MAX_CONTACTS = 3;
const RELATIONSHIPS = ['Bố', 'Mẹ', 'Vợ / Chồng', 'Anh / Chị / Em', 'Bạn bè', 'Đồng nghiệp'];

/** Liên hệ khẩn cấp (user_db): Trung tâm an toàn trong chuyến dùng để gọi / nhắn hành trình cho người thân. */
export default function EmergencyContacts({ initial }: { initial: EmergencyContact[] }) {
  const [contacts, setContacts] = useState(initial);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validPhone = /^0\d{9}$/.test(phone);
  const canAdd = name.trim().length >= 2 && validPhone && contacts.length < MAX_CONTACTS;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd) return;
    setBusy('add');
    setError(null);
    const r = await call<EmergencyContact>('/users/me/emergency-contacts', { body: { name: name.trim(), phone, relationship: relationship || undefined } });
    setBusy(null);
    if (!r.ok || !r.data) return setError(r.error ?? 'Không thêm được liên hệ.');
    setContacts(prev => [...prev, r.data!]);
    setName('');
    setPhone('');
    setRelationship('');
  }

  async function remove(c: EmergencyContact) {
    if (!window.confirm(`Xóa ${c.name} khỏi liên hệ khẩn cấp?`)) return;
    setBusy(c.id);
    setError(null);
    const r = await call(`/users/me/emergency-contacts/${c.id}`, { method: 'DELETE' });
    setBusy(null);
    if (!r.ok) return setError(r.error ?? 'Không xóa được liên hệ.');
    setContacts(prev => prev.filter(x => x.id !== c.id));
  }

  const input = 'h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100';
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Trong chuyến, mục <strong>Trung tâm an toàn</strong> cho phép gọi hoặc nhắn hành trình (tài xế, biển số, lộ trình) cho những người này chỉ với một chạm. Tối đa {MAX_CONTACTS} người.
      </p>
      {contacts.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {contacts.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{c.name}</div>
                <div className="text-xs text-slate-500">
                  {c.relationship ? `${c.relationship} · ` : ''}
                  {c.phone}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <a href={`tel:${c.phone}`} className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-700 hover:bg-brand-100" aria-label={`Gọi ${c.name}`}>
                  <Phone className="h-3.5 w-3.5" />
                </a>
                <button type="button" onClick={() => void remove(c)} disabled={busy === c.id} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa ${c.name}`}>
                  {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {contacts.length < MAX_CONTACTS ? (
        <form onSubmit={e => void add(e)} className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto]">
          <input value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="Họ tên người thân" className={input} />
          <input value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" placeholder="Số điện thoại (0xxxxxxxxx)" className={input} />
          <select value={relationship} onChange={e => setRelationship(e.target.value)} className={`${input} bg-white`}>
            <option value="">Quan hệ</option>
            {RELATIONSHIPS.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!canAdd || busy === 'add'} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Thêm
          </button>
        </form>
      ) : (
        <p className="text-xs text-slate-400">Đã đủ {MAX_CONTACTS} liên hệ. Xóa bớt để thêm người khác.</p>
      )}
      {phone && !validPhone && <p className="text-xs text-amber-700">Số điện thoại gồm 10 chữ số, bắt đầu bằng 0.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
