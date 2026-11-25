'use client';

import { ChevronDown, LifeBuoy, Loader2, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { call } from '@/lib/client';
import { time, vnd } from '@/lib/format';
import { TICKET_CATEGORY, TICKET_STATUS, TRIP_STATUS } from '@/lib/labels';
import type { SupportTicket, TicketCategory, Trip } from '@/lib/types';
import { EmptyState, Panel } from './Blocks';
import Pill from './Pill';

type Role = 'PASSENGER' | 'DRIVER';

const FAQ: Record<Role, { q: string; a: string }[]> = {
  DRIVER: [
    { q: 'Khách không ra điểm đón thì làm gì?', a: 'Bấm "Đã đến điểm đón", gọi cho khách và chờ ít nhất 2 phút. Sau đó mở "Không thể thực hiện chuyến?" và chọn "Khách không xuất hiện". Nếu khách cố tình bom, gửi phản ánh kèm mã chuyến để được xem xét tỷ lệ hủy.' },
    { q: 'Vì sao ví của tôi bị trừ tiền?', a: 'Với chuyến khách trả tiền mặt, bạn giữ toàn bộ tiền mặt và nền tảng trừ chiết khấu vào ví. Với chuyến trả bằng tài khoản, ví được cộng phần cước sau chiết khấu.' },
    { q: 'Khi nào tôi rút được tiền?', a: 'Bất cứ lúc nào số dư khả dụng từ 50.000 ₫ trở lên, tại mục Ví. Tiền được chuyển về tài khoản ngân hàng liên kết.' },
    { q: 'Hệ số giá trên bản đồ nhu cầu nghĩa là gì?', a: 'Là hệ số giá động của khu vực: số khách đang chờ so với số tài xế rảnh trong bán kính 3 km. Ô càng đỏ, khách càng nhiều so với tài xế và giá cuốc càng cao (tối đa ×2).' },
    { q: 'Tỷ lệ nhận cuốc được tính thế nào?', a: 'Số cuốc bạn nhận chia cho tổng số cuốc được giao. Từ chối hoặc để quá 60 giây không phản hồi đều tính là không nhận.' },
  ],
  PASSENGER: [
    { q: 'Tôi bị tính sai cước?', a: 'Giá được khóa lúc đặt và có bảng chi tiết trong trang chuyến đi (mở cửa, km, phút, hệ số giờ/thời tiết/nhu cầu). Nếu vẫn thấy sai, gửi phản ánh kèm mã chuyến.' },
    { q: 'Tiền tạm giữ khi nào được hoàn?', a: 'Khi chuyến bị hủy hoặc không tìm được tài xế, khoản tạm giữ được mở lại ngay vào số dư khả dụng.' },
    { q: 'Tôi để quên đồ trên xe?', a: 'Gửi yêu cầu loại "Thất lạc đồ" kèm mã chuyến; tổng đài sẽ liên hệ tài xế giúp bạn.' },
    { q: 'Làm sao báo sự cố an toàn?', a: 'Trong chuyến, dùng mục Trung tâm an toàn để gọi 113 hoặc chia sẻ hành trình cho người thân, sau đó gửi phản ánh loại "Sự cố an toàn".' },
  ],
};

export default function HelpCenter({
  role,
  initialTickets,
  recentTrips,
  initialCategory,
  initialTripId,
  tripHref,
}: {
  role: Role;
  initialTickets: SupportTicket[];
  recentTrips: Trip[];
  initialCategory?: string;
  initialTripId?: string;
  tripHref: string;
}) {
  const categories = Object.entries(TICKET_CATEGORY).filter(([, c]) => c.roles.includes(role));
  const [tickets, setTickets] = useState(initialTickets);
  const [category, setCategory] = useState<TicketCategory>(
    (categories.find(([k]) => k === initialCategory)?.[0] as TicketCategory) ?? (categories[0][0] as TicketCategory),
  );
  const [tripId, setTripId] = useState(initialTripId && recentTrips.some(t => t.tripId === initialTripId) ? initialTripId : initialTripId ?? '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const r = await call<SupportTicket>('/trips/support/tickets', { body: { category, subject, description, tripId: tripId || null } });
    setBusy(false);
    if (!r.ok || !r.data) return setMessage({ ok: false, text: r.error ?? 'Không gửi được yêu cầu.' });
    setTickets(prev => [r.data!, ...prev]);
    setSubject('');
    setDescription('');
    setMessage({ ok: true, text: `Đã tiếp nhận yêu cầu #${r.data.id.slice(0, 8).toUpperCase()}. Bộ phận hỗ trợ sẽ phản hồi trong vòng 24 giờ.` });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <div className="space-y-6">
        <Panel title="Câu hỏi thường gặp" padded={false}>
          <ul className="divide-y divide-slate-100">
            {FAQ[role].map(f => (
              <li key={f.q}>
                <details className="group px-5 py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
                  </summary>
                  <p className="mt-2 text-sm text-slate-600">{f.a}</p>
                </details>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Yêu cầu của bạn" padded={false}>
          {tickets.length === 0 ? (
            <EmptyState title="Chưa có yêu cầu nào" description="Các phản ánh, khiếu nại bạn gửi sẽ được theo dõi tại đây." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {tickets.map(t => {
                const st = TICKET_STATUS[t.status] ?? { label: t.status, tone: 'gray' as const };
                return (
                  <li key={t.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{t.subject}</span>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      #{t.id.slice(0, 8).toUpperCase()} · {TICKET_CATEGORY[t.category]?.label ?? t.category} · {time(t.createdAt)}
                      {t.tripId && (
                        <>
                          {' · '}
                          <Link href={`${tripHref}/${t.tripId}`} className="font-mono text-brand-600 hover:underline">
                            chuyến {t.tripId.slice(0, 8).toUpperCase()}
                          </Link>
                        </>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">{t.description}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <section className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <LifeBuoy className="h-5 w-5 text-brand-600" /> Gửi phản ánh / khiếu nại
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Vấn đề</span>
            <select value={category} onChange={e => setCategory(e.target.value as TicketCategory)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-brand-400">
              {categories.map(([key, c]) => (
                <option key={key} value={key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Chuyến liên quan (không bắt buộc)</span>
            <select value={tripId} onChange={e => setTripId(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-brand-400">
              <option value="">Không gắn chuyến</option>
              {tripId && !recentTrips.some(t => t.tripId === tripId) && <option value={tripId}>Chuyến {tripId.slice(0, 8).toUpperCase()}</option>}
              {recentTrips.map(t => (
                <option key={t.tripId} value={t.tripId}>
                  {t.tripId.slice(0, 8).toUpperCase()} · {new Date(t.createdAt).toLocaleDateString('vi-VN')} · {vnd(t.fare)} · {TRIP_STATUS[t.status]?.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Tiêu đề</span>
            <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={120} placeholder="Tóm tắt vấn đề" className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-brand-400" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Mô tả chi tiết</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={5} placeholder="Chuyện gì đã xảy ra, thời gian, địa điểm…" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-400" />
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || subject.trim().length < 3 || description.trim().length < 10}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Gửi yêu cầu
          </button>
          {message && <p className={message.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-600'}>{message.text}</p>}
          <p className="text-xs text-slate-400">Khẩn cấp về an toàn: gọi ngay 113 trước khi gửi phản ánh.</p>
        </div>
      </section>
    </div>
  );
}
