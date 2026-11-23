'use client';

import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { useCallback, useEffect, useState } from 'react';
import type { Point } from './types';

/** Tâm bản đồ khi trình duyệt chưa cho biết vị trí (trung tâm Hà Nội). */
export const FALLBACK_CENTER: Point = { lat: 21.0285, lng: 105.8542 };

/** Lấy vị trí hiện tại của trình duyệt (nếu người dùng cho phép). */
export function useBrowserLocation(auto = true) {
  const [location, setLocation] = useState<Point | null>(null);
  const [status, setStatus] = useState<'idle' | 'locating' | 'denied' | 'ok'>('idle');

  const locate = useCallback(
    () =>
      new Promise<Point | null>(resolve => {
        if (!('geolocation' in navigator)) {
          setStatus('denied');
          return resolve(null);
        }
        setStatus('locating');
        navigator.geolocation.getCurrentPosition(
          pos => {
            const point = { lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) };
            setLocation(point);
            setStatus('ok');
            resolve(point);
          },
          () => {
            setStatus('denied');
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 8000 },
        );
      }),
    [],
  );

  useEffect(() => {
    if (auto) void locate();
  }, [auto, locate]);
  return { location, status, locate };
}

/** Đổi tọa độ thành địa chỉ bằng Google Geocoding API. */
export function useReverseGeocoder() {
  // Không có APIProvider (chưa cấu hình key) thì hook trả về null.
  const geocoding = useMapsLibrary('geocoding');
  return useCallback(
    async (point: Point): Promise<string | null> => {
      if (!geocoding) return null;
      try {
        const { results } = await new geocoding.Geocoder().geocode({ location: { lat: point.lat, lng: point.lng }, language: 'vi' });
        return results[0]?.formatted_address?.replace(/, Việt Nam$/, '') ?? null;
      } catch {
        return null;
      }
    },
    [geocoding],
  );
}

/** Địa chỉ của một tọa độ (nếu chưa có sẵn địa chỉ lưu trong DB). */
export function useAddressOf(point: Point | null | undefined) {
  const reverse = useReverseGeocoder();
  const [address, setAddress] = useState<string | null>(point?.address ?? null);
  useEffect(() => {
    if (!point) return setAddress(null);
    if (point.address) return setAddress(point.address);
    let cancelled = false;
    void reverse(point).then(a => !cancelled && setAddress(a));
    return () => {
      cancelled = true;
    };
  }, [point?.lat, point?.lng, point?.address, reverse]); // eslint-disable-line react-hooks/exhaustive-deps
  return address;
}
