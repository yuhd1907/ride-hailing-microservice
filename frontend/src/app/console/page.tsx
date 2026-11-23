'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, Empty, Mono, PageHeader, StatusBadge, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { useInterval } from '@/lib/hooks';
import { useActiveSession } from '@/lib/store';

const SERVICES = [
  { name: 'User Service', path: '/users/ping', owner: 'TV1', tech: 'Spring Boot', publicPing: true },
  { name: 'Driver Service', path: '/drivers/ping', owner: 'TV1', tech: 'Spring Boot', publicPing: true },
  { name: 'Trip Service', path: '/trips/ping', owner: 'TV2', tech: 'Node.js', publicPing: false },
  { name: 'Matching Service', path: '/matching/ping', owner: 'TV2', tech: 'Node.js', publicPing: false },
  { name: 'Payment Service', path: '/payments/ping', owner: 'TV3', tech: 'Spring Boot', publicPing: false },
  { name: 'Notification Service', path: '/notifications/ping', owner: 'TV3', tech: 'Spring Boot', publicPing: false },
];

const TOOLS = [
  { name: 'Eureka', url: process.env.NEXT_PUBLIC_EUREKA_URL || 'http://localhost:8761', note: 'Danh sách instance đã đăng ký' },
  { name: 'Grafana', url: process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3000', note: 'Dashboard giám sát (profile observability)' },
  { name: 'Zipkin', url: process.env.NEXT_PUBLIC_ZIPKIN_URL || 'http://localhost:9411', note: 'Distributed tracing' },
  { name: 'RabbitMQ', url: process.env.NEXT_PUBLIC_RABBITMQ_URL || 'http://localhost:15672', note: 'Hàng đợi, DLQ' },
];

interface Health {
  status: 'UP' | 'DOWN' | 'AUTH' | 'CHECKING';
  http: number;
  ms: number;
  instance: string | null;
}

interface Breaker {
  state: string;
  failureRate: string;
  bufferedCalls: number;
  failedCalls: number;
  notPermittedCalls: number;
}

export default function OverviewPage() {
  const session = useActiveSession();
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [gateway, setGateway] = useState<{ status: string; http: number } | null>(null);
  const [breakers, setBreakers] = useState<Record<string, Breaker> | null>(null);
  const [auto, setAuto] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    const gw = await api<{ status?: string }>('/actuator/health', { session: null, silent: true });
    setGateway({ status: gw.ok ? gw.data?.status ?? 'UP' : 'DOWN', http: gw.status });

    const results = await Promise.all(
      SERVICES.map(async svc => {
        const r = await api(svc.path, { session: svc.publicPing ? null : session, silent: true });
        const status: Health['status'] = r.ok ? 'UP' : r.status === 401 && r.correlationId ? 'AUTH' : 'DOWN';
        return [svc.path, { status, http: r.status, ms: r.durationMs, instance: r.instance }] as const;
      }),
    );
    setHealth(Object.fromEntries(results));

    const cb = await api<{ circuitBreakers?: Record<string, Breaker> }>('/actuator/circuitbreakers', { session: null, silent: true });
    setBreakers(cb.ok ? cb.data?.circuitBreakers ?? {} : null);
    setCheckedAt(new Date());
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useInterval(() => void refresh(), 5000, auto);

  const up = Object.values(health).filter(h => h.status === 'UP').length;

  return (
    <>
      <PageHeader
        title="Tổng quan hệ thống"
        description="Trạng thái API Gateway, 6 microservice nghiệp vụ và circuit breaker của từng service. Tự làm mới mỗi 5 giây."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
              Tự làm mới
            </label>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()}>
              Kiểm tra ngay
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="API Gateway" value={gateway ? <StatusBadge status={gateway.status} /> : '…'} note={gateway ? `HTTP ${gateway.http}` : 'đang kiểm tra'} />
        <Stat label="Service hoạt động" value={`${up} / ${SERVICES.length}`} note="phản hồi /ping qua Gateway" />
        <Stat
          label="Circuit breaker đang mở"
          value={breakers ? Object.values(breakers).filter(b => b.state !== 'CLOSED').length : '—'}
          note="OPEN hoặc HALF_OPEN"
        />
        <Stat label="Lần kiểm tra cuối" value={checkedAt ? checkedAt.toLocaleTimeString('vi-VN') : '—'} note={session ? `token: ${session.email}` : 'chưa có phiên đăng nhập'} />
      </div>

      {!session && (
        <div className="mb-4">
          <Alert>Ping của Trip, Matching, Payment, Notification yêu cầu JWT. Đăng nhập ở mục Tài khoản & phiên để xem đủ trạng thái.</Alert>
        </div>
      )}

      <div className="grid gap-6 2xl:grid-cols-5">
        <Card className="2xl:col-span-3" title="Microservice nghiệp vụ" description="Gateway định tuyến qua lb://<SERVICE> (Eureka + round-robin)">
          <Table head={['Service', 'Công nghệ', 'Phụ trách', 'Trạng thái', 'HTTP', 'Thời gian', 'Instance xử lý']}>
            {SERVICES.map(svc => {
              const h = health[svc.path];
              return (
                <tr key={svc.path}>
                  <Td>
                    <div className="font-medium">{svc.name}</div>
                    <Mono>{svc.path}</Mono>
                  </Td>
                  <Td className="text-slate-500">{svc.tech}</Td>
                  <Td>
                    <Badge color={svc.owner === 'TV1' ? 'blue' : 'gray'}>{svc.owner}</Badge>
                  </Td>
                  <Td>{h ? h.status === 'AUTH' ? <Badge color="amber">CẦN TOKEN</Badge> : <StatusBadge status={h.status} /> : '…'}</Td>
                  <Td>{h?.http ?? '…'}</Td>
                  <Td>{h ? `${h.ms} ms` : '…'}</Td>
                  <Td>
                    <Mono>{h?.instance ?? '—'}</Mono>
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card className="2xl:col-span-2" title="Circuit breaker tại Gateway" description="Resilience4j: cửa sổ 10 lần gọi, mở khi lỗi ≥ 50%, mở 10 giây">
          {breakers === null ? (
            <Empty>Không đọc được /actuator/circuitbreakers</Empty>
          ) : Object.keys(breakers).length === 0 ? (
            <Empty>Chưa có breaker nào được tạo (chưa có request qua route)</Empty>
          ) : (
            <Table head={['Breaker', 'Trạng thái', 'Tỉ lệ lỗi', 'Lỗi / đệm', 'Bị chặn']}>
              {Object.entries(breakers)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, b]) => (
                  <tr key={name}>
                    <Td>
                      <Mono>{name}</Mono>
                    </Td>
                    <Td>
                      <StatusBadge status={b.state} />
                    </Td>
                    <Td>{b.failureRate}</Td>
                    <Td>
                      {b.failedCalls} / {b.bufferedCalls}
                    </Td>
                    <Td>{b.notPermittedCalls}</Td>
                  </tr>
                ))}
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-6" title="Công cụ vận hành" description="Mở trong tab mới">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {TOOLS.map(t => (
            <a
              key={t.name}
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start justify-between rounded-md border border-slate-200 px-4 py-3 hover:border-brand-500 hover:bg-brand-50"
            >
              <div>
                <div className="text-sm font-semibold text-slate-800">{t.name}</div>
                <div className="text-xs text-slate-500">{t.note}</div>
                <div className="mt-1 font-mono text-[11px] text-slate-400">{t.url}</div>
              </div>
              <ExternalLink className="h-4 w-4 text-slate-400 group-hover:text-brand-600" />
            </a>
          ))}
        </div>
      </Card>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {note && <div className="mt-1 truncate text-xs text-slate-400">{note}</div>}
    </div>
  );
}
