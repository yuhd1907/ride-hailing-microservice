'use client';

import clsx from 'clsx';
import { CheckCircle2, Copy, Play, PlayCircle, XCircle, Zap } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Card, HttpStatus, PageHeader, Select } from '@/components/ui';
import { isDriver, isPassenger } from '@/lib/format';
import { useMounted } from '@/lib/hooks';
import { probe, SCENARIOS, type Scenario, type ScenarioResult } from '@/lib/scenarios';
import { useActiveSession, useAppState } from '@/lib/store';

interface Line {
  text: string;
  kind: 'info' | 'ok' | 'fail';
  at: number;
}

export default function ScenariosPage() {
  const mounted = useMounted();
  const sessions = useAppState(s => s.sessions);
  const passengers = sessions.filter(s => isPassenger(s.roles));
  const drivers = sessions.filter(s => isDriver(s.roles));
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ScenarioResult & { ms: number }>>({});
  const [logs, setLogs] = useState<Record<string, Line[]>>({});

  async function run(scenario: Scenario) {
    setRunning(scenario.id);
    setLogs(l => ({ ...l, [scenario.id]: [] }));
    setResults(r => {
      const next = { ...r };
      delete next[scenario.id];
      return next;
    });
    const log = (text: string, kind: Line['kind'] = 'info') =>
      setLogs(l => ({ ...l, [scenario.id]: [...(l[scenario.id] ?? []), { text, kind, at: Date.now() }] }));
    const started = performance.now();
    let result: ScenarioResult;
    try {
      result = await scenario.run({ passengers, drivers, log });
    } catch (error) {
      result = { pass: false, summary: error instanceof Error ? error.message : String(error) };
    }
    setResults(r => ({ ...r, [scenario.id]: { ...result, ms: Math.round(performance.now() - started) } }));
    setRunning(null);
  }

  async function runAll() {
    for (const s of SCENARIOS) if (ready(s)) await run(s);
  }

  const ready = (s: Scenario) => (s.needs?.passengers ?? 0) <= passengers.length && (s.needs?.drivers ?? 0) <= drivers.length;
  const passed = Object.values(results).filter(r => r.pass).length;

  if (!mounted) return null;

  return (
    <>
      <PageHeader
        title="Kịch bản kiểm thử phân tán"
        description="Mỗi kịch bản tự gọi API qua Gateway, kiểm tra kết quả cuối cùng và tự dọn dẹp chuyến đã tạo. Chi tiết từng request xem ở Nhật ký request."
        actions={
          <Button icon={<PlayCircle className="h-4 w-4" />} loading={running !== null} onClick={() => void runAll()}>
            Chạy tất cả
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm shadow-sm">
        <span className="text-slate-500">Phiên sẵn có:</span>
        <Badge color={passengers.length >= 2 ? 'green' : 'amber'}>{passengers.length} hành khách</Badge>
        <Badge color={drivers.length >= 1 ? 'green' : 'amber'}>{drivers.length} tài xế</Badge>
        {Object.keys(results).length > 0 && (
          <span className="ml-auto font-medium text-slate-700">
            Kết quả: {passed}/{Object.keys(results).length} đạt
          </span>
        )}
      </div>
      {(passengers.length < 2 || drivers.length < 1) && (
        <div className="mb-6">
          <Alert>Một số kịch bản cần 2 hành khách và 1 tài xế. Vào Tài khoản & phiên, bấm “Đăng nhập cả 3”.</Alert>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {SCENARIOS.map(s => {
          const result = results[s.id];
          const lines = logs[s.id] ?? [];
          return (
            <Card
              key={s.id}
              title={
                <span className="flex items-center gap-2">
                  {result && (result.pass ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />)}
                  {s.title}
                </span>
              }
              description={s.requirement}
              actions={
                <Button size="sm" variant="secondary" icon={<Play className="h-3.5 w-3.5" />} disabled={!ready(s) || (running !== null && running !== s.id)} loading={running === s.id} onClick={() => void run(s)}>
                  Chạy
                </Button>
              }
            >
              <p className="text-sm text-slate-600">{s.description}</p>
              <p className="mt-2 text-sm">
                <span className="font-medium text-slate-700">Mong đợi: </span>
                <span className="text-slate-600">{s.expected}</span>
              </p>
              {!ready(s) && <p className="mt-2 text-xs text-amber-700">Cần {s.needs?.passengers ?? 0} hành khách và {s.needs?.drivers ?? 0} tài xế đã đăng nhập.</p>}
              {(lines.length > 0 || result) && (
                <div className="mt-3 rounded-md bg-slate-950 p-3 font-mono text-[11.5px] leading-relaxed">
                  {lines.map((l, i) => (
                    <div key={i} className={clsx(l.kind === 'ok' && 'text-emerald-400', l.kind === 'fail' && 'text-red-400', l.kind === 'info' && 'text-slate-300')}>
                      › {l.text}
                    </div>
                  ))}
                  {result && (
                    <div className={clsx('mt-1 font-semibold', result.pass ? 'text-emerald-400' : 'text-red-400')}>
                      {result.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'} · {result.summary} ({(result.ms / 1000).toFixed(1)} giây)
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        <CircuitBreakerCard />
      </div>
    </>
  );
}

const TARGETS = [
  { path: '/drivers/ping', container: 'driver_service_1', auth: false },
  { path: '/users/ping', container: 'user_service', auth: false },
  { path: '/trips/ping', container: 'trip_service', auth: true },
  { path: '/payments/ping', container: 'payment_service', auth: true },
];

function CircuitBreakerCard() {
  const session = useActiveSession();
  const [target, setTarget] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<{ status: number; ms: number; state?: string }[]>([]);
  const t = TARGETS[target];
  const stopCmd = `docker compose -f deploy/docker-compose.yml stop ${t.container}`;
  const startCmd = `docker compose -f deploy/docker-compose.yml start ${t.container}`;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" /> Circuit breaker và phục hồi sau lỗi
        </span>
      }
      description="Đề 4.4 · Dừng một service rồi quan sát Gateway"
      className="xl:col-span-2"
    >
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>Bắn 10 request khi service còn chạy: tất cả 200, breaker CLOSED.</li>
        <li>
          Dừng service bằng lệnh bên dưới, bắn tiếp: vài lần đầu 503/504 (chờ timeout), sau đó breaker OPEN và trả <strong>503 ngay</strong> trong vài ms.
        </li>
        <li>Chạy lại service, chờ khoảng 10–60 giây (Eureka đăng ký lại), bắn tiếp: breaker sang HALF_OPEN rồi CLOSED.</li>
      </ol>
      <div className="mb-4 grid gap-2 md:grid-cols-2">
        <Command text={stopCmd} />
        <Command text={startCmd} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={target} onChange={e => setTarget(Number(e.target.value))} className="w-56">
          {TARGETS.map((x, i) => (
            <option key={x.path} value={i}>
              {x.path}
            </option>
          ))}
        </Select>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const out = await probe(t.path, 10, t.auth ? session : null);
            setRows(r => [...out, ...r].slice(0, 60));
            setBusy(false);
          }}
        >
          Bắn 10 request
        </Button>
        <Button variant="ghost" onClick={() => setRows([])}>
          Xóa
        </Button>
        {t.auth && !session && <span className="text-xs text-amber-700">Route này cần đăng nhập</span>}
      </div>
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1 rounded border border-slate-200 px-1.5 py-1 text-[11px]" title={r.state ? `circuitState=${r.state}` : undefined}>
              <HttpStatus status={r.status} />
              <span className="text-slate-500">{r.ms} ms</span>
              {r.state && <span className="font-semibold text-red-600">{r.state}</span>}
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400">Mới nhất ở đầu. Trạng thái breaker theo thời gian thực xem ở trang Tổng quan.</p>
    </Card>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 font-mono text-[11.5px] text-slate-200">
      <span className="flex-1 truncate">{text}</span>
      <button
        type="button"
        className="text-slate-400 hover:text-white"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        aria-label="Sao chép lệnh"
      >
        {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
