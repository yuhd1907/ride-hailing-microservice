import type { Metadata } from 'next';
import { Container, ErrorState, PageTitle, Panel } from '@/components/site/Blocks';
import ChangePasswordForm from '@/components/site/ChangePasswordForm';
import EmergencyContacts from '@/components/site/EmergencyContacts';
import ProfileForm from '@/components/site/ProfileForm';
import { time } from '@/lib/format';
import { gateway, requireUser } from '@/lib/server/gateway';
import type { EmergencyContact, UserProfile } from '@/lib/types';

export const metadata: Metadata = { title: 'Tài khoản' };

export default async function AccountPage() {
  const user = requireUser();
  const [profile, contacts] = await Promise.all([gateway<UserProfile>('/users/me'), gateway<EmergencyContact[]>('/users/me/emergency-contacts')]);

  return (
    <Container className="max-w-2xl">
      <PageTitle title="Tài khoản của tôi" />
      {!profile.data ? (
        <ErrorState message={profile.error ?? 'Không tải được thông tin tài khoản.'} />
      ) : (
        <div className="space-y-6">
          <Panel title="Thông tin cá nhân">
            <ProfileForm fullName={profile.data.fullName} phone={profile.data.phone} />
          </Panel>
          <Panel title="Đăng nhập">
            <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
              <dt className="text-slate-500">Email</dt>
              <dd className="text-slate-900">{profile.data.email}</dd>
              <dt className="text-slate-500">Vai trò</dt>
              <dd className="text-slate-900">{user.role === 'ROLE_DRIVER' ? 'Tài xế' : 'Khách hàng'}</dd>
              <dt className="text-slate-500">Trạng thái</dt>
              <dd className="text-slate-900">{profile.data.status === 'ACTIVE' ? 'Đang hoạt động' : profile.data.status}</dd>
              <dt className="text-slate-500">Ngày tham gia</dt>
              <dd className="text-slate-900">{time(profile.data.createdAt)}</dd>
            </dl>
          </Panel>
          <Panel title="Đổi mật khẩu">
            <ChangePasswordForm />
          </Panel>
          <div id="lien-he-khan-cap" className="scroll-mt-24">
            <Panel title="Liên hệ khẩn cấp">
              {contacts.error ? <ErrorState message={contacts.error} /> : <EmergencyContacts initial={contacts.data ?? []} />}
            </Panel>
          </div>
        </div>
      )}
    </Container>
  );
}
