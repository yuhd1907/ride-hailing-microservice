import type { ReactNode } from 'react';
import Footer from '@/components/site/Footer';
import MapsProvider from '@/components/site/MapsProvider';
import SiteHeader from '@/components/site/SiteHeader';
import { currentUser } from '@/lib/server/gateway';

export const dynamic = 'force-dynamic';

export default function SiteLayout({ children }: { children: ReactNode }) {
  const user = currentUser();
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <SiteHeader user={user} />
      <div className="flex-1">
        <MapsProvider>{children}</MapsProvider>
      </div>
      <Footer />
    </div>
  );
}
