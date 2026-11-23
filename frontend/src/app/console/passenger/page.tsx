'use client';

import { Calculator, MapPin, RefreshCw, Send, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import PointInput from '@/components/PointInput';
import TripLifecycle from '@/components/TripLifecycle';
import { Alert, Button, Card, Empty, Field, Input, KeyValue, Mono, PageHeader, StatusBadge, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { isPassenger, shortId, time, vnd } from '@/lib/format';
import { useAction, useInterval, useMounted } from '@/lib/hooks';
import { PLACES } from '@/lib/places';
import { actions, useActiveSession, useAppState } from '@/lib/store';
import type { Driver, FareEstimate, Point, Session, Trip } from '@/lib/types';

export default function PassengerPage() {
  const mounted = useMounted();
  const session = useActiveSession();
  const [pickup, setPickup] = useState<Point>(PLACES[0].point);
  const [destination, setDestination] = useState<Point>(PLACES[2].point);

  return (
    <>
      <PageHeader
        title="Hành khách"
        description="Ước tính giá, tìm tài xế gần, đặt chuyến và theo dõi vòng đời chuyến. Giá do server tính (dynamic-v1: theo loại xe, km, phút, giờ cao điểm và cầu/cung, làm tròn lên 1.000 ₫)."
      />
      {mounted && !isPassenger(session?.roles) && (
        <div className="mb-4">
          <Alert kind="error">Phiên đang chọn không phải hành khách. Chọn hoặc đăng nhập tài khoản hành khách ở thanh trên cùng.</Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <Card title="Lộ trình" description="Chọn điểm đón và điểm đến">
            <div className="space-y-4">
              <PointInput label="Điểm đón" value={pickup} onChange={setPickup} />
              <PointInput label="Điểm đến" value={destination} onChange={setDestination} />
            </div>
          </Card>
          <BookingCard pickup={pickup} destination={destination} session={session} />
        </div>
        <div className="space-y-6 xl:col-span-2">
          <NearbyDriversCard pickup={pickup} />
          {mounted && <MyTripsCard session={session} />}
        </div>
      </div>
    </>
  );
}

function BookingCard({ pickup, destination, session }: { pickup: Point; destination: Point; session: Session | null }) {
  const estimate = useAction(() => api<FareEstimate>('/trips/estimate', { body: { pickup, destination } }));
  const book = useAction(() => api<Trip>('/trips', { body: { pickup, destination } }));

  return (
    <Card title="Đặt chuyến" description="POST /trips/estimate, POST /trips">
      <div className="flex gap-2">
        <Button variant="secondary" icon={<Calculator className="h-4 w-4" />} loading={estimate.loading} onClick={() => void estimate.run()}>
          Ước tính giá
        </Button>
        <Button
          icon={<Send className="h-4 w-4" />}
          loading={book.loading}
          onClick={async () => {
            const r = await book.run();
            if (r.ok && session) actions.trackTrip({ tripId: r.data.tripId, ownerSessionId: session.id, createdAt: Date.now() });
          }}
        >
          Đặt xe
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        {estimate.error && <Alert kind="error">{estimate.error}</Alert>}
        {estimate.result?.ok && (
          <KeyValue
            items={[
              ['Quãng đường', `${estimate.result.data.estimatedDistance} km`],
              ['Giá cước', <strong key="fare">{vnd(estimate.result.data.fareAmount)}</strong>],
              ['Phiên bản giá', <Mono key="v">{estimate.result.data.pricingVersion}</Mono>],
            ]}
          />
        )}
        {book.error && <Alert kind="error">{book.error}</Alert>}
        {book.result?.ok && (
          <Alert kind="success">
            Đã tạo chuyến <Mono>{book.result.data.tripId}</Mono>. Matching đang tìm tài xế — theo dõi ở bảng “Chuyến của tôi”.
          </Alert>
        )}
      </div>
    </Card>
  );
}

function NearbyDriversCard({ pickup }: { pickup: Point }) {
  const [radius, setRadius] = useState(5);
  const search = useAction(() => api<Driver[]>(`/drivers/available?lat=${pickup.lat}&lng=${pickup.lng}&radius=${radius}`, { session: null }));

  return (
    <Card
      title="Tài xế sẵn sàng gần điểm đón"
      description="GET /drivers/available — Redis GEOSEARCH, lọc lại theo trạng thái AVAILABLE trong PostgreSQL"
      actions={
        <div className="flex items-end gap-2">
          <Input type="number" min={0.5} step={0.5} value={radius} onChange={e => setRadius(Number(e.target.value))} className="w-20" aria-label="Bán kính km" />
          <span className="pb-2 text-xs text-slate-500">km</span>
          <Button size="sm" variant="secondary" icon={<MapPin className="h-3.5 w-3.5" />} loading={search.loading} onClick={() => void search.run()}>
            Tìm
          </Button>
        </div>
      }
    >
      {search.error && <Alert kind="error">{search.error}</Alert>}
      {!search.result ? (
        <Empty>Bấm “Tìm” để tra tài xế quanh điểm đón</Empty>
      ) : search.result.ok && search.result.data.length === 0 ? (
        <Empty>Không có tài xế AVAILABLE trong bán kính {radius} km. Bật tài xế và cập nhật vị trí ở trang Tài xế.</Empty>
      ) : search.result.ok ? (
        <>
          <Table head={['Tài xế', 'Xe', 'Trạng thái', 'Khoảng cách', 'ID']}>
            {search.result.data.map(d => (
              <tr key={d.id}>
                <Td className="font-medium">{d.fullName}</Td>
                <Td>
                  {d.vehicleType} · {d.licensePlate}
                </Td>
                <Td>
                  <StatusBadge status={d.status} />
                </Td>
                <Td>{d.distance != null ? `${d.distance.toFixed(2)} km` : '—'}</Td>
                <Td>
                  <Mono>{shortId(d.id)}</Mono>
                </Td>
              </tr>
            ))}
          </Table>
          <div className="mt-2 text-xs text-slate-400">Xử lý bởi instance: {search.result.instance ?? '—'}</div>
        </>
      ) : null}
    </Card>
  );
}

function MyTripsCard({ session }: { session: Session | null }) {
  const tracked = useAppState(s => s.trips.filter(t => t.ownerSessionId === session?.id));
  const sessions = useAppState(s => s.sessions);
  const [trips, setTrips] = useState<Record<string, Trip>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [manualId, setManualId] = useState('');
  const [auto, setAuto] = useState(true);

  const ids = tracked.map(t => t.tripId).join(',');
  const refresh = useCallback(async () => {
    if (!session) return;
    const results = await Promise.all(
      ids
        .split(',')
        .filter(Boolean)
        .map(async id => [id, await api<Trip>(`/trips/${id}`, { session, silent: true })] as const),
    );
    setTrips(prev => {
      const next = { ...prev };
      results.forEach(([id, r]) => r.ok && (next[id] = r.data));
      return next;
    });
    setErrors(Object.fromEntries(results.filter(([, r]) => !r.ok).map(([id, r]) => [id, errorMessage(r)])));
  }, [ids, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useInterval(() => void refresh(), 3000, auto && tracked.length > 0);

  async function cancel(id: string) {
    const r = await api<Trip>(`/trips/${id}/cancel`, { method: 'POST', session });
    if (!r.ok) setErrors(e => ({ ...e, [id]: errorMessage(r) }));
    void refresh();
  }

  return (
    <Card
      title="Chuyến của tôi"
      description={`GET /trips/{id} — tự làm mới mỗi 3 giây · ${session?.email ?? 'chưa chọn phiên'}`}
      actions={
        <>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
            Tự làm mới
          </label>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void refresh()}>
            Làm mới
          </Button>
        </>
      }
    >
      <form
        className="mb-4 flex gap-2"
        onSubmit={e => {
          e.preventDefault();
          if (session && manualId.trim()) actions.trackTrip({ tripId: manualId.trim(), ownerSessionId: session.id, createdAt: Date.now() });
          setManualId('');
        }}
      >
        <Field label="Theo dõi thêm chuyến theo ID">
          <Input value={manualId} onChange={e => setManualId(e.target.value)} placeholder="tripId (UUID)" className="w-96" />
        </Field>
        <Button type="submit" size="sm" variant="secondary" className="self-end">
          Thêm
        </Button>
      </form>

      {tracked.length === 0 ? (
        <Empty>Chưa có chuyến nào của phiên này. Đặt xe ở cột bên trái.</Empty>
      ) : (
        <div className="space-y-3">
          {tracked.map(t => {
            const trip = trips[t.tripId];
            const driverName = sessions.find(s => s.userId === trip?.driverId)?.email;
            return (
              <div key={t.tripId} className="rounded-md border border-slate-200 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <Mono>{t.tripId}</Mono>
                    {trip && <StatusBadge status={trip.status} />}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<X className="h-3.5 w-3.5" />}
                      disabled={!trip || !['REQUESTED', 'MATCHING', 'AWAITING_DRIVER'].includes(trip.status)}
                      onClick={() => void cancel(t.tripId)}
                    >
                      Hủy chuyến
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => actions.forgetTrip(t.tripId)}>
                      Bỏ theo dõi
                    </Button>
                  </div>
                </div>
                {trip ? (
                  <>
                    <TripLifecycle status={trip.status} />
                    <div className="mt-3 grid gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
                      <div>
                        Giá: <strong className="text-slate-900">{vnd(trip.fare)}</strong>
                      </div>
                      <div>Quãng đường: {trip.estimatedDistance} km</div>
                      <div>
                        Tài xế: <Mono>{driverName ?? shortId(trip.driverId)}</Mono>
                      </div>
                      <div>Cập nhật: {time(trip.updatedAt)}</div>
                      {trip.rejectedDriverIds && trip.rejectedDriverIds.length > 0 && (
                        <div className="sm:col-span-4">Tài xế đã từ chối: {trip.rejectedDriverIds.map(shortId).join(', ')}</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-slate-400">Đang tải…</div>
                )}
                {errors[t.tripId] && <div className="mt-2 text-xs text-red-600">{errors[t.tripId]}</div>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
