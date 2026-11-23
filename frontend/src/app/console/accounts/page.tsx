'use client';

import { LogIn, LogOut, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Input, JsonBlock, KeyValue, Mono, PageHeader, Select, Table, Td } from '@/components/ui';
import { api, decodeJwt, errorMessage } from '@/lib/api';
import { login, SEED_ACCOUNTS, SEED_PASSWORD } from '@/lib/auth';
import { roleLabel, time } from '@/lib/format';
import { useAction, useMounted } from '@/lib/hooks';
import { actions, useActiveSession, useAppState } from '@/lib/store';
import type { Session, UserProfile } from '@/lib/types';

export default function AccountsPage() {
  const mounted = useMounted();
  const sessions = useAppState(s => s.sessions);
  const active = useActiveSession();

  return (
    <>
      <PageHeader
        title="Tài khoản & phiên đăng nhập"
        description="Đăng nhập nhiều tài khoản cùng lúc để thử các kịch bản nhiều người dùng. Phiên đang chọn ở thanh trên cùng sẽ gửi kèm JWT trong mọi request."
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <LoginCard />
          <RegisterCard />
        </div>
        <div className="space-y-6 xl:col-span-2">
          <Card title="Phiên đang mở" description="Token lưu trong trình duyệt này; hết hạn sau 1 giờ">
            {!mounted || sessions.length === 0 ? (
              <Empty>Chưa có phiên nào. Đăng nhập nhanh bằng tài khoản mẫu ở bên trái.</Empty>
            ) : (
              <Table head={['Email', 'Vai trò', 'User ID', 'Hết hạn', '']}>
                {sessions.map(s => (
                  <SessionRow key={s.id} session={s} active={s.id === active?.id} />
                ))}
              </Table>
            )}
          </Card>
          {mounted && active && <ProfileCard session={active} />}
        </div>
      </div>
    </>
  );
}

function SessionRow({ session, active }: { session: Session; active: boolean }) {
  const logout = useAction(() => api('/auth/logout', { method: 'POST', session }));
  return (
    <tr className={active ? 'bg-brand-50/50' : undefined}>
      <Td>
        <div className="flex items-center gap-2 font-medium">
          {session.email}
          {active && <Badge color="blue">đang dùng</Badge>}
        </div>
        {logout.error && <div className="text-xs text-red-600">{logout.error}</div>}
      </Td>
      <Td>{roleLabel(session.roles)}</Td>
      <Td>
        <Mono>{session.userId}</Mono>
      </Td>
      <Td>{time(session.expiresAt)}</Td>
      <Td className="text-right">
        <div className="flex justify-end gap-1">
          {!active && (
            <Button size="sm" variant="secondary" onClick={() => actions.setActiveSession(session.id)}>
              Dùng
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon={<LogOut className="h-3.5 w-3.5" />}
            loading={logout.loading}
            title="Gọi POST /auth/logout: token bị đưa vào blacklist Redis"
            onClick={async () => {
              const r = await logout.run();
              if (r.ok) actions.removeSession(session.id);
            }}
          >
            Đăng xuất
          </Button>
          <Button size="sm" variant="ghost" title="Chỉ xóa khỏi trình duyệt, token vẫn còn hiệu lực" onClick={() => actions.removeSession(session.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Td>
    </tr>
  );
}

function LoginCard() {
  const [email, setEmail] = useState(SEED_ACCOUNTS[0].email);
  const [password, setPassword] = useState(SEED_PASSWORD);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function doLogin(e: string, p: string) {
    setBusy(e);
    const r = await login(e, p);
    setBusy(null);
    setMessage(r.error ? { kind: 'error', text: r.error } : { kind: 'success', text: `Đã đăng nhập ${e}` });
  }

  return (
    <Card title="Đăng nhập" description="POST /auth/login">
      <div className="mb-4">
        <div className="mb-2 text-xs font-medium text-slate-600">Tài khoản mẫu (mật khẩu {SEED_PASSWORD})</div>
        <div className="flex flex-wrap gap-2">
          {SEED_ACCOUNTS.map(a => (
            <Button key={a.email} size="sm" variant="secondary" loading={busy === a.email} onClick={() => doLogin(a.email, SEED_PASSWORD)}>
              {a.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              for (const a of SEED_ACCOUNTS) await doLogin(a.email, SEED_PASSWORD);
            }}
          >
            Đăng nhập cả 3
          </Button>
        </div>
      </div>
      <form
        className="space-y-3"
        onSubmit={e => {
          e.preventDefault();
          void doLogin(email, password);
        }}
      >
        <Field label="Email">
          <Input value={email} onChange={e => setEmail(e.target.value)} type="email" required />
        </Field>
        <Field label="Mật khẩu">
          <Input value={password} onChange={e => setPassword(e.target.value)} type="password" required />
        </Field>
        <Button type="submit" className="w-full" icon={<LogIn className="h-4 w-4" />} loading={busy === email}>
          Đăng nhập
        </Button>
        {message && <Alert kind={message.kind}>{message.text}</Alert>}
      </form>
    </Card>
  );
}

function RegisterCard() {
  const [form, setForm] = useState({ email: '', password: 'Password@123', fullName: '', phone: '09', role: 'ROLE_PASSENGER' });
  const register = useAction(() => api('/auth/register', { session: null, body: form }));
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <Card title="Đăng ký tài khoản" description="POST /auth/register — có kiểm tra dữ liệu đầu vào">
      <form
        className="space-y-3"
        onSubmit={async e => {
          e.preventDefault();
          const r = await register.run();
          if (r.ok) await login(form.email, form.password);
        }}
      >
        <Field label="Email">
          <Input value={form.email} onChange={set('email')} type="email" placeholder="user@ridehail.com" required />
        </Field>
        <Field label="Mật khẩu" hint="8–32 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt">
          <Input value={form.password} onChange={set('password')} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Họ tên">
            <Input value={form.fullName} onChange={set('fullName')} required />
          </Field>
          <Field label="Số điện thoại">
            <Input value={form.phone} onChange={set('phone')} placeholder="0901234567" required />
          </Field>
        </div>
        <Field label="Vai trò">
          <Select value={form.role} onChange={set('role')}>
            <option value="ROLE_PASSENGER">Hành khách</option>
            <option value="ROLE_DRIVER">Tài xế</option>
          </Select>
        </Field>
        <Button type="submit" className="w-full" variant="secondary" icon={<UserPlus className="h-4 w-4" />} loading={register.loading}>
          Đăng ký và đăng nhập
        </Button>
        {register.error && <Alert kind="error">{register.error}</Alert>}
        {register.result?.ok && <Alert kind="success">Đã tạo tài khoản {form.email}</Alert>}
      </form>
    </Card>
  );
}

function ProfileCard({ session }: { session: Session }) {
  const profile = useAction(() => api<UserProfile>('/users/me'));
  const [edit, setEdit] = useState({ fullName: '', phone: '' });
  const update = useAction(() => api<UserProfile>('/users/me', { method: 'PUT', body: edit }));
  const claims = decodeJwt(session.token);

  return (
    <Card
      title={`Hồ sơ: ${session.email}`}
      description="GET /users/me, PUT /users/me — chỉ sửa được hồ sơ của chính mình"
      actions={
        <Button size="sm" variant="secondary" loading={profile.loading} onClick={() => void profile.run()}>
          Tải hồ sơ
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {profile.error && <Alert kind="error">{profile.error}</Alert>}
          {profile.result?.ok ? (
            <KeyValue
              items={[
                ['Họ tên', profile.result.data.fullName],
                ['Điện thoại', profile.result.data.phone],
                ['Trạng thái', profile.result.data.status],
                ['Vai trò', profile.result.data.roles?.join(', ')],
                ['Tạo lúc', time(profile.result.data.createdAt)],
              ]}
            />
          ) : (
            <Empty>Bấm “Tải hồ sơ” để gọi /users/me</Empty>
          )}
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={async e => {
              e.preventDefault();
              const r = await update.run();
              if (r.ok) void profile.run();
            }}
          >
            <Field label="Họ tên mới">
              <Input value={edit.fullName} onChange={e => setEdit(v => ({ ...v, fullName: e.target.value }))} />
            </Field>
            <Field label="SĐT mới">
              <Input value={edit.phone} onChange={e => setEdit(v => ({ ...v, phone: e.target.value }))} />
            </Field>
            <div className="col-span-2 flex items-center gap-3">
              <Button type="submit" size="sm" loading={update.loading}>
                Cập nhật hồ sơ
              </Button>
              {update.error && <span className="text-xs text-red-600">{errorMessage(update.result!)}</span>}
              {update.result?.ok && <span className="text-xs text-emerald-600">Đã cập nhật</span>}
            </div>
          </form>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-slate-600">Claim trong JWT (giải mã phần payload)</div>
          <JsonBlock value={claims} />
        </div>
      </div>
    </Card>
  );
}
