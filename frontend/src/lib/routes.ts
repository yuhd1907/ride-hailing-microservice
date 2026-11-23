'use client';

import { useEffect, useState } from 'react';
import { GOOGLE_MAPS_API_KEY, MAPS_ENABLED } from './maps';
import type { Point } from './types';

export interface RouteInfo {
  /** Polyline mã hóa (Google encoded polyline) của lộ trình theo đường phố. */
  encodedPath: string;
  distanceMeters: number;
  durationSeconds: number;
}

const cache = new Map<string, RouteInfo>();

/** Lộ trình lái xe thực tế giữa hai điểm (Google Routes API, có tính giao thông hiện tại). */
export async function computeRoute(origin: Point, destination: Point, signal?: AbortSignal): Promise<RouteInfo | null> {
  const key = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}>${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      // Chỉ lấy các trường cần dùng: Routes API tính phí theo field mask.
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      languageCode: 'vi',
      regionCode: 'VN',
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[] };
  const route = data.routes?.[0];
  if (!route?.polyline?.encodedPolyline) return null;
  const info: RouteInfo = {
    encodedPath: route.polyline.encodedPolyline,
    distanceMeters: route.distanceMeters ?? 0,
    durationSeconds: Number.parseInt(route.duration ?? '0', 10) || 0,
  };
  cache.set(key, info);
  return info;
}

/** Hook: lộ trình giữa hai điểm; null khi chưa đủ điểm hoặc không tính được (khi đó bản đồ vẽ đường thẳng). */
export function useRoute(origin: Point | null | undefined, destination: Point | null | undefined) {
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const deps = [origin?.lat, origin?.lng, destination?.lat, destination?.lng];

  useEffect(() => {
    if (!MAPS_ENABLED || !origin || !destination) {
      setRoute(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      computeRoute(origin, destination, controller.signal)
        .then(r => setRoute(r))
        .catch(() => setRoute(null))
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { route, loading };
}

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km` : `${m} m`;
}

export function formatDuration(s: number) {
  const minutes = Math.max(1, Math.round(s / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút` : `${minutes} phút`;
}
