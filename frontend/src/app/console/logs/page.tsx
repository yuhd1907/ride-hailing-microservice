'use client';

import clsx from 'clsx';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, HttpStatus, Input, JsonBlock, Mono, PageHeader, Select, Table, Td } from '@/components/ui';
import { time } from '@/lib/format';
import { useMounted } from '@/lib/hooks';
import { actions, useAppState } from '@/lib/store';

export default function LogsPage() {
  const mounted = useMounted();
  const logs = useAppState(s => s.logs);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'ok' | 'error'>('all');
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter(l => {
      if (status === 'ok' && !(l.status >= 200 && l.status < 300)) return false;
      if (status === 'error' && l.status >= 200 && l.status < 300) return false;
      if (!q) return true;
      return [l.path, l.method, l.correlationId, l.instance, l.actor, String(l.status)].some(v => v?.toLowerCase().includes(q));
    });
  }, [logs, query, status]);

  if (!mounted) return null;

  return (
    <>
      <PageHeader
        title="Nhật ký request"
        description="Mọi request giao diện gửi qua Gateway (300 request gần nhất). Dùng correlationId để tìm cùng luồng trong Grafana/Loki hoặc Zipkin."
        actions={
          <Button variant="secondary" icon={<Trash2 className="h-4 w-4" />} onClick={actions.clearLogs}>
            Xóa nhật ký
          </Button>
        }
      />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap gap-3 border-b border-slate-100 px-5 py-3">
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Lọc theo đường dẫn, correlationId, instance, email…" className="max-w-md" />
          <Select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="w-40">
            <option value="all">Mọi trạng thái</option>
            <option value="ok">Thành công (2xx)</option>
            <option value="error">Lỗi</option>
          </Select>
          <span className="ml-auto self-center text-xs text-slate-500">
            {filtered.length} / {logs.length} request
          </span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-5">
            <Empty>Chưa có request nào.</Empty>
          </div>
        ) : (
          <Table head={['', 'Thời gian', 'Method', 'Đường dẫn', 'HTTP', 'Thời gian xử lý', 'Người gọi', 'Instance', 'Correlation ID']}>
            {filtered.map(l => (
              <Fragment key={l.id}>
                <tr className={clsx('cursor-pointer hover:bg-slate-50', open === l.id && 'bg-slate-50')} onClick={() => setOpen(open === l.id ? null : l.id)}>
                  <Td>{open === l.id ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}</Td>
                  <Td className="text-slate-500">{time(l.at)}</Td>
                  <Td>
                    <Badge color={l.method === 'GET' ? 'gray' : 'blue'}>{l.method}</Badge>
                  </Td>
                  <Td className="max-w-[360px] truncate">
                    <Mono>{l.path}</Mono>
                  </Td>
                  <Td>
                    <HttpStatus status={l.status} />
                  </Td>
                  <Td>{l.durationMs} ms</Td>
                  <Td className="text-slate-600">{l.actor ?? <span className="text-slate-400">ẩn danh</span>}</Td>
                  <Td>
                    <Mono>{l.instance ?? '—'}</Mono>
                  </Td>
                  <Td>
                    <Mono>{l.correlationId ?? '—'}</Mono>
                  </Td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td colSpan={9} className="bg-slate-50 px-5 py-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Request body</div>
                          <JsonBlock value={l.requestBody ?? null} />
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Response body</div>
                          <JsonBlock value={l.responseBody} />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
