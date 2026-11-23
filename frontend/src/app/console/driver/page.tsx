'use client';

import { Check, CheckCheck, Navigation, Power, PowerOff, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import PointInput from '@/components/PointInput';
import TripLifecycle from '@/components/TripLifecycle';
import { Alert, Button, Card, Empty, Field, Input, KeyValue, Mono, PageHeader, Select, StatusBadge } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { isDriver, time, vnd } from '@/lib/format';
import { useAction, useInterval, useMounted } from '@/lib/hooks';
import { PLACES } from '@/lib/places';
import { useActiveSession, useAppState } from '@/lib/store';
import type { ApiResult, Driver, Point, Session, Trip } from '@/lib/types';

export default function DriverPage() {
  const mounted = useMounted();
  const session = useActiveSession();
  const [profile, setProfile] = useState<ApiResult<Driver> | null>(null);
  const [auto, setAuto] = useState(true);

  const load = useCallback(async (silent = true) => {
    if (!session) return;
    setProfile(await api<Driver>('/drivers/me', { session, silent }));
  }, [session]);

  useEffect(() => {
    setProfile(null);
    void load(false);
  }, [load]);
  useInterval(() => void load(), 3000, auto && !!session);

  if (!mounted) return null;

  const driver = profile?.ok ? profile.data : null;

  return (
    <>
      <PageHeader
        title="Tài xế"
        description="Bật nhận chuyến, cập nhật vị trí giả lập, nhận / từ chối / hoàn thành chuyến. Trạng thái: OFFLINE → AVAILABLE → RESERVED → ON_TRIP → AVAILABLE."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
              Tự làm mới (3 giây)
            </label>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load(false)}>
              Làm mới
            </Button>
          </>
        }
      />
      {!isDriver(session?.roles) && (
        <div className="mb-4">
          <Alert kind="error">Phiên đang chọn không phải tài xế. Đăng nhập “Tài xế 1” ở trang Tài khoản & phiên rồi chọn ở thanh trên cùng.</Alert>
        </div>
      )}
      {session && profile && !profile.ok && profile.status === 404 ? (
        <CreateProfileCard onCreated={() => void load(false)} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6">
            <ProfileCard driver={driver} profile={profile} onChange={() => void load(false)} />
            <LocationCard disabled={!driver} />
          </div>
          <div className="xl:col-span-2">{session && <CurrentTripCard driver={driver} session={session} onChange={() => void load(false)} />}</div>
        </div>
      )}
    </>
  );
}

function ProfileCard({ driver, profile, onChange }: { driver: Driver | null; profile: ApiResult<Driver> | null; onChange: () => void }) {
  const online = useAction(() => api<Driver>('/drivers/me/go-online', { method: 'POST' }));
  const offline = useAction(() => api<Driver>('/drivers/me/go-offline', { method: 'POST' }));
  const error = online.error || offline.error;

  return (
    <Card title="Hồ sơ & trạng thái" description="GET /drivers/me · POST /drivers/me/go-online | go-offline">
      {profile && !profile.ok && <Alert kind="error">{errorMessage(profile)}</Alert>}
      {!driver ? (
        <Empty>Chưa tải được hồ sơ tài xế</Empty>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">{driver.fullName}</div>
              <div className="text-xs text-slate-500">
                {driver.vehicleType} · {driver.licensePlate}
              </div>
            </div>
            <StatusBadge status={driver.status} />
          </div>
          <KeyValue
            items={[
              ['Driver ID', <Mono key="id">{driver.id}</Mono>],
              ['Chuyến hiện tại', <Mono key="trip">{driver.currentTripId ?? '—'}</Mono>],
              ['Reservation', <Mono key="res">{driver.reservationId ?? '—'}</Mono>],
              ['Cập nhật', time(driver.updatedAt)],
              ['Instance xử lý', <Mono key="inst">{profile?.instance ?? '—'}</Mono>],
            ]}
          />
          <div className="flex gap-2">
            <Button
              icon={<Power className="h-4 w-4" />}
              disabled={driver.status !== 'OFFLINE'}
              loading={online.loading}
              onClick={async () => {
                await online.run();
                onChange();
              }}
            >
              Bật nhận chuyến
            </Button>
            <Button
              variant="secondary"
              icon={<PowerOff className="h-4 w-4" />}
              disabled={driver.status !== 'AVAILABLE'}
              loading={offline.loading}
              onClick={async () => {
                await offline.run();
                onChange();
              }}
            >
              Tắt
            </Button>
          </div>
          {error && <Alert kind="error">{error}</Alert>}
        </div>
      )}
    </Card>
  );
}

function LocationCard({ disabled }: { disabled: boolean }) {
  const [point, setPoint] = useState<Point>(PLACES[0].point);
  const update = useAction(() => api('/drivers/me/location', { body: { latitude: point.lat, longitude: point.lng } }));

  return (
    <Card title="Vị trí giả lập" description="POST /drivers/me/location → Redis GEO">
      <div className="space-y-3">
        <PointInput label="Vị trí hiện tại" value={point} onChange={setPoint} />
        <Button icon={<Navigation className="h-4 w-4" />} disabled={disabled} loading={update.loading} onClick={() => void update.run()}>
          Gửi vị trí
        </Button>
        {update.error && <Alert kind="error">{update.error}</Alert>}
        {update.result?.ok && <Alert kind="success">Đã cập nhật vị trí (instance {update.result.instance ?? '—'})</Alert>}
        <p className="text-xs text-slate-400">Tài xế chỉ xuất hiện trong tìm kiếm khi đang AVAILABLE và vị trí cập nhật trong vòng 300 giây.</p>
      </div>
    </Card>
  );
}

function CurrentTripCard({ driver, session, onChange }: { driver: Driver | null; session: Session; onChange: () => void }) {
  const tripId = driver?.currentTripId ?? null;
  const [trip, setTrip] = useState<ApiResult<Trip> | null>(null);
  const [lastTripId, setLastTripId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const passengers = useAppState(s => s.sessions);

  useEffect(() => {
    if (tripId) setLastTripId(tripId);
  }, [tripId]);

  const shownId = tripId ?? lastTripId;
  const loadTrip = useCallback(async () => {
    if (shownId) setTrip(await api<Trip>(`/trips/${shownId}`, { session, silent: true }));
  }, [shownId, session]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip, driver?.status]);

  async function act(action: 'accept' | 'reject' | 'complete') {
    if (!shownId) return;
    setBusy(action);
    const r = await api<Trip>(`/trips/${shownId}/${action}`, { method: 'POST', session });
    setBusy(null);
    const labels = { accept: 'Đã nhận chuyến', reject: 'Đã từ chối chuyến — Matching sẽ ghép tài xế khác', complete: 'Đã hoàn thành chuyến — Payment đang thu tiền' };
    setMessage(r.ok ? { kind: 'success', text: labels[action] } : { kind: 'error', text: errorMessage(r) });
    onChange();
    void loadTrip();
  }

  const t = trip?.ok ? trip.data : null;
  const passenger = passengers.find(s => s.userId === t?.passengerId)?.email;

  return (
    <Card title="Chuyến được giao" description="POST /trips/{id}/accept | reject | complete — chỉ tài xế được ghép mới thao tác được">
      {!shownId ? (
        <Empty>Chưa có chuyến nào được giao. Bật nhận chuyến, gửi vị trí, rồi cho một hành khách đặt xe gần đó.</Empty>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Mono>{shownId}</Mono>
            {t && <StatusBadge status={t.status} />}
          </div>
          {t && <TripLifecycle status={t.status} />}
          {trip && !trip.ok && <Alert kind="error">{errorMessage(trip)}</Alert>}
          {t && (
            <KeyValue
              items={[
                ['Hành khách', <Mono key="p">{passenger ?? t.passengerId}</Mono>],
                ['Điểm đón', `${t.pickup.lat}, ${t.pickup.lng}`],
                ['Điểm đến', `${t.destination.lat}, ${t.destination.lng}`],
                ['Giá cước', vnd(t.fare)],
                ['Cập nhật', time(t.updatedAt)],
              ]}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button icon={<Check className="h-4 w-4" />} disabled={t?.status !== 'AWAITING_DRIVER'} loading={busy === 'accept'} onClick={() => void act('accept')}>
              Nhận chuyến
            </Button>
            <Button
              variant="danger"
              icon={<X className="h-4 w-4" />}
              disabled={t?.status !== 'AWAITING_DRIVER'}
              loading={busy === 'reject'}
              onClick={() => void act('reject')}
            >
              Từ chối
            </Button>
            <Button
              variant="secondary"
              icon={<CheckCheck className="h-4 w-4" />}
              disabled={t?.status !== 'IN_PROGRESS'}
              loading={busy === 'complete'}
              onClick={() => void act('complete')}
            >
              Hoàn thành chuyến
            </Button>
          </div>
          {message && <Alert kind={message.kind}>{message.text}</Alert>}
          <p className="text-xs text-slate-400">Giữ chỗ hết hạn sau 60 giây nếu tài xế không nhận; khi đó tài xế tự về AVAILABLE.</p>
        </div>
      )}
    </Card>
  );
}

function CreateProfileCard({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ licensePlate: '29A-12345', vehicleType: 'MOTORCYCLE' });
  const create = useAction(() => api<Driver>('/drivers', { body: form }));
  return (
    <Card title="Tạo hồ sơ tài xế" description="Tài khoản tài xế này chưa có hồ sơ trong Driver Service · POST /drivers" className="max-w-xl">
      <form
        className="space-y-3"
        onSubmit={async e => {
          e.preventDefault();
          const r = await create.run();
          if (r.ok) onCreated();
        }}
      >
        <Field label="Biển số xe" hint="3–20 ký tự: chữ, số, dấu chấm hoặc gạch ngang">
          <Input value={form.licensePlate} onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value }))} />
        </Field>
        <Field label="Loại xe">
          <Select value={form.vehicleType} onChange={e => setForm(f => ({ ...f, vehicleType: e.target.value }))}>
            <option value="MOTORCYCLE">Xe máy</option>
            <option value="CAR_4_SEAT">Ô tô 4 chỗ</option>
            <option value="CAR_7_SEAT">Ô tô 7 chỗ</option>
          </Select>
        </Field>
        <Button type="submit" loading={create.loading}>
          Tạo hồ sơ
        </Button>
        {create.error && <Alert kind="error">{create.error}</Alert>}
      </form>
    </Card>
  );
}
