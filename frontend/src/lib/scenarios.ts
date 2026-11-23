'use client';

import { api, decodeJwt, errorMessage } from './api';
import { PLACES } from './places';
import type { Driver, Session, Trip } from './types';

export type Log = (line: string, kind?: 'info' | 'ok' | 'fail') => void;

export interface ScenarioContext {
  passengers: Session[];
  drivers: Session[];
  log: Log;
}

export interface ScenarioResult {
  pass: boolean;
  summary: string;
}

export interface Scenario {
  id: string;
  title: string;
  requirement: string;
  description: string;
  expected: string;
  needs?: { passengers?: number; drivers?: number };
  run: (ctx: ScenarioContext) => Promise<ScenarioResult>;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const PICKUP = PLACES[0].point;
const DESTINATION = PLACES[2].point;
const OPEN_STATES = ['REQUESTED', 'MATCHING', 'AWAITING_DRIVER'];

async function prepareDriver(driver: Session, log: Log) {
  const me = await api<Driver>('/drivers/me', { session: driver });
  if (!me.ok) throw new Error(`Không đọc được hồ sơ tài xế ${driver.email}: ${errorMessage(me)}`);
  if (me.data.status === 'OFFLINE') {
    const r = await api('/drivers/me/go-online', { method: 'POST', session: driver });
    log(`Tài xế ${driver.email} bật nhận chuyến → HTTP ${r.status}`);
  } else if (me.data.status !== 'AVAILABLE') {
    throw new Error(`Tài xế ${driver.email} đang ${me.data.status} (chuyến ${me.data.currentTripId}). Hoàn thành hoặc hủy chuyến đó trước.`);
  }
  const loc = await api('/drivers/me/location', { session: driver, body: { latitude: PICKUP.lat, longitude: PICKUP.lng } });
  log(`Đặt vị trí tài xế tại điểm đón → HTTP ${loc.status}`);
}

async function waitTrip(tripId: string, session: Session, until: (t: Trip) => boolean, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last: Trip | null = null;
  while (Date.now() < deadline) {
    const r = await api<Trip>(`/trips/${tripId}`, { session, silent: true });
    if (r.ok) {
      last = r.data;
      if (until(r.data)) return r.data;
    }
    await sleep(700);
  }
  return last;
}

async function cancelIfOpen(trip: Trip | null, session: Session, log: Log) {
  if (trip && OPEN_STATES.includes(trip.status)) {
    const r = await api(`/trips/${trip.tripId}/cancel`, { method: 'POST', session });
    log(`Dọn dẹp: hủy chuyến ${trip.tripId.slice(0, 8)} → HTTP ${r.status}`);
  }
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'double-booking',
    title: 'Hai hành khách đồng thời đặt cùng một tài xế',
    requirement: 'Đề 7.4 · Kiểm soát tương tranh',
    description:
      'Đưa một tài xế về điểm đón, rồi hai hành khách gửi yêu cầu đặt xe cùng một lúc tại đúng điểm đó. Matching của cả hai chuyến đều chọn tài xế gần nhất và gọi Driver giữ chỗ song song.',
    expected: 'Tài xế chỉ được gán cho tối đa một chuyến. Chuyến còn lại được ghép tài xế khác hoặc chuyển FAILED.',
    needs: { passengers: 2, drivers: 1 },
    async run({ passengers, drivers, log }) {
      const [a, b] = passengers;
      const driver = drivers[0];
      await prepareDriver(driver, log);
      log('Gửi đồng thời 2 yêu cầu POST /trips…');
      const [ra, rb] = await Promise.all([
        api<Trip>('/trips', { session: a, body: { pickup: PICKUP, destination: DESTINATION } }),
        api<Trip>('/trips', { session: b, body: { pickup: PICKUP, destination: DESTINATION } }),
      ]);
      if (!ra.ok || !rb.ok) return { pass: false, summary: `Đặt xe lỗi: ${errorMessage(ra.ok ? rb : ra)}` };
      log(`Chuyến A ${ra.data.tripId.slice(0, 8)} (${a.email}), chuyến B ${rb.data.tripId.slice(0, 8)} (${b.email})`);
      log('Chờ Matching xử lý (tối đa 20 giây)…');
      const settled = (t: Trip) => !['REQUESTED', 'MATCHING'].includes(t.status);
      const [ta, tb] = await Promise.all([waitTrip(ra.data.tripId, a, settled), waitTrip(rb.data.tripId, b, settled)]);
      log(`Chuyến A: ${ta?.status} · tài xế ${ta?.driverId?.slice(0, 8) ?? '—'}`);
      log(`Chuyến B: ${tb?.status} · tài xế ${tb?.driverId?.slice(0, 8) ?? '—'}`);
      const me = await api<Driver>('/drivers/me', { session: driver });
      log(`Driver Service: ${driver.email} = ${me.data?.status}, currentTripId ${me.data?.currentTripId?.slice(0, 8) ?? '—'}`);
      const both = ta?.driverId === driver.userId && tb?.driverId === driver.userId;
      const consistent = !me.data?.currentTripId || [ta?.tripId, tb?.tripId].includes(me.data.currentTripId);
      await cancelIfOpen(ta, a, log);
      await cancelIfOpen(tb, b, log);
      const pass = !both && consistent && !!(ta?.driverId === driver.userId || tb?.driverId === driver.userId);
      return {
        pass,
        summary: pass
          ? 'Tài xế chỉ được giữ cho đúng một chuyến; trạng thái Driver Service khớp với Trip.'
          : both
            ? 'LỖI: tài xế bị gán cho cả hai chuyến.'
            : 'Không chuyến nào được ghép với tài xế này (có thể có tài xế khác gần hơn, hoặc tài xế chưa AVAILABLE).',
      };
    },
  },
  {
    id: 'accept-cancel-race',
    title: 'Tài xế nhận chuyến đúng lúc khách hủy',
    requirement: 'Đề 4.3 · Xung đột giữa hai tiến trình',
    description: 'Tạo chuyến, chờ đến AWAITING_DRIVER, rồi gửi đồng thời POST /accept (tài xế) và POST /cancel (khách).',
    expected: 'Đúng một thao tác thành công, thao tác kia nhận 409. Trạng thái tài xế khớp với bên thắng.',
    needs: { passengers: 1, drivers: 1 },
    async run({ passengers, drivers, log }) {
      const passenger = passengers[0];
      const driver = drivers[0];
      await prepareDriver(driver, log);
      const created = await api<Trip>('/trips', { session: passenger, body: { pickup: PICKUP, destination: DESTINATION } });
      if (!created.ok) return { pass: false, summary: errorMessage(created) };
      log(`Tạo chuyến ${created.data.tripId.slice(0, 8)}, chờ ghép tài xế…`);
      const trip = await waitTrip(created.data.tripId, passenger, t => t.status !== 'REQUESTED' && t.status !== 'MATCHING');
      if (trip?.status !== 'AWAITING_DRIVER' || trip.driverId !== driver.userId) {
        await cancelIfOpen(trip, passenger, log);
        return { pass: false, summary: `Chuyến không được ghép với ${driver.email} (trạng thái ${trip?.status}).` };
      }
      log('Gửi đồng thời accept và cancel…');
      const [acc, can] = await Promise.all([
        api(`/trips/${trip.tripId}/accept`, { method: 'POST', session: driver }),
        api(`/trips/${trip.tripId}/cancel`, { method: 'POST', session: passenger }),
      ]);
      log(`accept → HTTP ${acc.status} · cancel → HTTP ${can.status}`, 'info');
      const final = await api<Trip>(`/trips/${trip.tripId}`, { session: passenger });
      const me = await api<Driver>('/drivers/me', { session: driver });
      log(`Chuyến cuối cùng: ${final.data?.status} · tài xế: ${me.data?.status}`);
      const winners = [acc.ok, can.ok].filter(Boolean).length;
      const consistent =
        (final.data?.status === 'IN_PROGRESS' && me.data?.status === 'ON_TRIP') ||
        (final.data?.status === 'CANCELLED' && me.data?.status === 'AVAILABLE');
      if (final.data?.status === 'IN_PROGRESS') {
        await api(`/trips/${trip.tripId}/complete`, { method: 'POST', session: driver });
        log('Dọn dẹp: hoàn thành chuyến để trả tài xế về AVAILABLE');
      }
      return {
        pass: winners === 1 && consistent,
        summary:
          winners === 1 && consistent
            ? `Chỉ ${acc.ok ? 'accept' : 'cancel'} thắng; bên kia bị 409. Trip và Driver nhất quán.`
            : `Có ${winners} thao tác thành công hoặc trạng thái không khớp (trip ${final.data?.status}, driver ${me.data?.status}).`,
      };
    },
  },
  {
    id: 'reject-rematch',
    title: 'Tài xế từ chối, hệ thống ghép lại',
    requirement: 'Đề 7.3 · Accept / Reject',
    description: 'Tạo chuyến, chờ tài xế được giữ, tài xế từ chối. Kiểm tra tài xế về AVAILABLE ngay và chuyến quay lại MATCHING.',
    expected: 'Từ chối trả 200, tài xế AVAILABLE ngay (không chờ 60 giây), tài xế nằm trong danh sách đã từ chối.',
    needs: { passengers: 1, drivers: 1 },
    async run({ passengers, drivers, log }) {
      const passenger = passengers[0];
      const driver = drivers[0];
      await prepareDriver(driver, log);
      const created = await api<Trip>('/trips', { session: passenger, body: { pickup: PICKUP, destination: DESTINATION } });
      if (!created.ok) return { pass: false, summary: errorMessage(created) };
      const trip = await waitTrip(created.data.tripId, passenger, t => t.status === 'AWAITING_DRIVER' || t.status === 'FAILED');
      if (trip?.driverId !== driver.userId) {
        await cancelIfOpen(trip, passenger, log);
        return { pass: false, summary: `Chuyến không được ghép với ${driver.email}.` };
      }
      const rej = await api<Trip>(`/trips/${trip.tripId}/reject`, { method: 'POST', session: driver });
      log(`reject → HTTP ${rej.status} (${rej.durationMs} ms)`);
      const me = await api<Driver>('/drivers/me', { session: driver });
      log(`Tài xế sau khi từ chối: ${me.data?.status}`);
      const after = await waitTrip(trip.tripId, passenger, t => t.status !== 'MATCHING', 6000);
      log(`Chuyến sau khi từ chối: ${after?.status}; đã từ chối: ${(after?.rejectedDriverIds ?? []).map(x => x.slice(0, 8)).join(', ')}`);
      const again = await api(`/trips/${trip.tripId}/reject`, { method: 'POST', session: driver });
      log(`Từ chối lần 2 → HTTP ${again.status} (mong đợi 403/409)`);
      await cancelIfOpen(after, passenger, log);
      const pass = rej.ok && me.data?.status === 'AVAILABLE' && !!after?.rejectedDriverIds?.includes(driver.userId) && !again.ok;
      return { pass, summary: pass ? 'Tài xế được nhả ngay và bị loại khỏi lượt ghép tiếp theo.' : 'Kết quả không như mong đợi, xem nhật ký.' };
    },
  },
  {
    id: 'load-balancing',
    title: 'Cân bằng tải giữa các instance Driver',
    requirement: 'Đề 7.5 · Multiple-instance scaling',
    description: 'Gửi 12 request GET /drivers/available liên tiếp, đếm header X-Handled-By-Instance.',
    expected: 'Khi chạy profile scale (2 instance), request chia đều cho cả hai instance.',
    async run({ log }) {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 12; i++) {
        const r = await api(`/drivers/available?lat=${PICKUP.lat}&lng=${PICKUP.lng}&radius=1`, { session: null, silent: true });
        const key = r.instance ?? `không có header (HTTP ${r.status})`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      Object.entries(counts).forEach(([k, v]) => log(`${k}: ${v} request`));
      const instances = Object.keys(counts).filter(k => !k.startsWith('không'));
      return {
        pass: instances.length >= 2,
        summary:
          instances.length >= 2
            ? `Round-robin qua ${instances.length} instance.`
            : 'Chỉ có 1 instance trả lời. Chạy thêm instance 2 bằng --profile scale để thấy cân bằng tải.',
      };
    },
  },
  {
    id: 'internal-block',
    title: 'Chặn API nội bộ từ bên ngoài',
    requirement: 'Đề 4.5 · Kiểm soát truy cập',
    description: 'Gọi trực tiếp /internal/** qua Gateway, kể cả các biến thể mã hóa đường dẫn.',
    expected: 'Không biến thể nào trả về 2xx.',
    async run({ log }) {
      const paths = [
        '/internal/drivers/available?lat=21&lng=105&radius=5',
        '/internal/users/00000000-0000-0000-0000-000000000000',
        '/INTERNAL/users/00000000-0000-0000-0000-000000000000',
        '/drivers/%2e%2e/internal/drivers/available?lat=21&lng=105',
        '/internal;x=1/users/00000000-0000-0000-0000-000000000000',
      ];
      let leaked = 0;
      let unreachable = 0;
      for (const p of paths) {
        const r = await api(p, { session: null });
        // Không có X-Correlation-ID nghĩa là Gateway không trả lời, không phải Gateway từ chối.
        if (!r.correlationId) unreachable++;
        if (r.ok) leaked++;
        log(`${p} → HTTP ${r.status}`, r.ok || !r.correlationId ? 'fail' : 'ok');
      }
      if (unreachable > 0) return { pass: false, summary: 'Gateway không phản hồi, chưa kiểm tra được.' };
      return { pass: leaked === 0, summary: leaked === 0 ? 'Mọi biến thể đều bị từ chối.' : `${leaked} đường dẫn lọt qua Gateway!` };
    },
  },
  {
    id: 'spoof-header',
    title: 'Giả mạo danh tính bằng header X-User-Id',
    requirement: 'Đề 4.5 · Xác thực',
    description: 'Gửi token của phiên A nhưng tự đặt X-User-Id / X-User-Roles của người khác, gọi GET /users/me.',
    expected: 'Gateway xóa header giả và gắn lại từ token: kết quả vẫn là hồ sơ của chính A.',
    needs: { passengers: 1 },
    async run({ passengers, drivers, log }) {
      const me = passengers[0];
      const victim = drivers[0]?.userId ?? '00000000-0000-0000-0000-000000000001';
      const r = await api<{ id: string; email: string }>('/users/me', {
        session: me,
        headers: { 'X-User-Id': victim, 'X-User-Roles': 'ROLE_DRIVER' },
      });
      log(`Gửi X-User-Id=${victim.slice(0, 8)}… → HTTP ${r.status}, nhận hồ sơ ${r.data?.email ?? '—'}`);
      const pass = r.ok && r.data.id === me.userId;
      return { pass, summary: pass ? 'Header giả bị bỏ qua.' : 'Có thể giả mạo danh tính!' };
    },
  },
  {
    id: 'logout-blacklist',
    title: 'Đăng xuất thu hồi JWT (blacklist Redis)',
    requirement: 'Đề 4.5 · Xác thực',
    description: 'Đăng nhập một token mới, gọi /users/me, đăng xuất, rồi dùng lại đúng token đó.',
    expected: 'Trước đăng xuất 200, sau đăng xuất 401 dù token chưa hết hạn.',
    needs: { passengers: 1 },
    async run({ passengers, log }) {
      const email = passengers[0].email;
      const loginRes = await api<{ token: string; userId: string }>('/auth/login', {
        session: null,
        body: { email, password: 'Password@123' },
      });
      if (!loginRes.ok) return { pass: false, summary: `Không đăng nhập lại được ${email} bằng mật khẩu mẫu: ${errorMessage(loginRes)}` };
      const claims = decodeJwt(loginRes.data.token);
      const temp: Session = {
        id: 'temp',
        email,
        userId: loginRes.data.userId,
        roles: [],
        token: loginRes.data.token,
        expiresAt: Number(claims?.exp ?? 0) * 1000,
      };
      const before = await api('/users/me', { session: temp });
      const out = await api('/auth/logout', { method: 'POST', session: temp });
      const after = await api('/users/me', { session: temp });
      log(`Trước đăng xuất: HTTP ${before.status} · đăng xuất: HTTP ${out.status} · sau đăng xuất: HTTP ${after.status}`);
      const pass = before.ok && out.ok && after.status === 401;
      return { pass, summary: pass ? 'Token đã bị thu hồi ngay sau đăng xuất.' : 'Token vẫn dùng được sau đăng xuất.' };
    },
  },
  {
    id: 'rate-limit',
    title: 'Giới hạn tần suất request',
    requirement: 'Đề 4.5 · Chống lạm dụng',
    description: 'Bắn 40 request song song tới GET /drivers/available từ cùng một IP.',
    expected: 'Một phần request nhận 429 Too Many Requests (giới hạn 10/giây, dồn tối đa 20).',
    async run({ log }) {
      const results = await Promise.all(
        Array.from({ length: 40 }, () => api(`/drivers/available?lat=${PICKUP.lat}&lng=${PICKUP.lng}&radius=1`, { session: null, silent: true })),
      );
      const by: Record<number, number> = {};
      results.forEach(r => (by[r.status] = (by[r.status] ?? 0) + 1));
      Object.entries(by).forEach(([s, n]) => log(`HTTP ${s}: ${n} request`));
      const limited = by[429] ?? 0;
      return { pass: limited > 0, summary: limited > 0 ? `${limited}/40 request bị chặn bởi rate limiter.` : 'Không request nào bị chặn.' };
    },
  },
];

/** Gửi N request liên tiếp tới một service để quan sát circuit breaker. */
export async function probe(path: string, count: number, session: Session | null) {
  const out: { status: number; ms: number; state?: string }[] = [];
  for (let i = 0; i < count; i++) {
    const r = await api<{ circuitState?: string }>(path, { session, silent: true });
    out.push({ status: r.status, ms: r.durationMs, state: r.data?.circuitState });
  }
  return out;
}
