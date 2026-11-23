'use client';

import { APIProvider } from '@vis.gl/react-google-maps';
import type { ReactNode } from 'react';
import { GOOGLE_MAPS_API_KEY, MAPS_ENABLED } from '@/lib/maps';

/** Tải Google Maps JavaScript API một lần cho toàn bộ trang (tiếng Việt, vùng VN). */
export default function MapsProvider({ children }: { children: ReactNode }) {
  if (!MAPS_ENABLED) return <>{children}</>;
  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY} language="vi" region="VN" libraries={['places', 'geocoding', 'marker', 'geometry']}>
      {children}
    </APIProvider>
  );
}
