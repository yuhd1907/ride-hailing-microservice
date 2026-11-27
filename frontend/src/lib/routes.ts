'use client';

import { useEffect, useState } from 'react';
import { GOOGLE_MAPS_API_KEY, MAPS_ENABLED } from './maps';
import { cumulativeMeters, decodePolyline } from './polyline';
import type { Point, VehicleType } from './types';

/** Tình trạng giao thông của một đoạn lộ trình (Google: travelAdvisory.speedReadingIntervals). */
export type TrafficSpeed = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';

/** Đoạn [start, end] tính theo chỉ số điểm của polyline đã giải mã. */
export interface SpeedInterval {
  start: number;
  end: number;
  speed: TrafficSpeed;
}

/** Một bước chỉ đường: thao tác (rẽ trái, đi thẳng…) tại điểm bắt đầu của bước. */
export interface NavStep {
  maneuver: string;
  /** Dòng chỉ dẫn chính ("Rẽ trái vào Đ. Trần Phú"). */
  instruction: string;
  /** Các dòng phụ Google kèm theo ("Đường bị giới hạn sử dụng"). */
  notes: string[];
  distanceMeters: number;
  durationSeconds: number;
  start: Point;
}

export interface RouteInfo {
  /** Polyline mã hóa (Google encoded polyline) của lộ trình theo đường phố. */
  encodedPath: string;
  distanceMeters: number;
  /** Thời gian đi có tính giao thông hiện tại. */
  durationSeconds: number;
  /** Thời gian đi khi đường thoáng; chênh với durationSeconds là thời gian mất vì kẹt xe. */
  staticDurationSeconds: number;
  /** Nhãn Google: DEFAULT_ROUTE (tuyến đề xuất) hoặc DEFAULT_ROUTE_ALTERNATE. */
  labels: string[];
  speedIntervals: SpeedInterval[];
  /** Chỉ có khi yêu cầu steps (màn hình dẫn đường của tài xế). */
  steps: NavStep[];
}

export interface RouteOptions {
  /** Xe máy đi theo chế độ TWO_WHEELER (giống Trip Service khi tính giá), ô tô theo DRIVE. */
  vehicleType?: VehicleType | null;
  /** Lấy thêm tối đa 2 tuyến thay thế. Không dùng cùng `via`. */
  alternatives?: boolean;
  /** Lấy các bước chỉ đường. */
  steps?: boolean;
  /** Điểm buộc đi qua (không dừng) để bám theo một tuyến cho trước. */
  via?: Point[];
}

const cache = new Map<string, RouteInfo[]>();
const seconds = (value?: string) => Number.parseFloat(value ?? '0') || 0;
const SPEEDS: TrafficSpeed[] = ['NORMAL', 'SLOW', 'TRAFFIC_JAM'];
const latLng = (p: Point) => ({ latLng: { latitude: p.lat, longitude: p.lng } });

interface ApiRoute {
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  routeLabels?: string[];
  polyline?: { encodedPolyline?: string };
  travelAdvisory?: { speedReadingIntervals?: { startPolylinePointIndex?: number; endPolylinePointIndex?: number; speed?: string }[] };
  legs?: {
    steps?: {
      distanceMeters?: number;
      staticDuration?: string;
      startLocation?: { latLng?: { latitude?: number; longitude?: number } };
      navigationInstruction?: { maneuver?: string; instructions?: string };
    }[];
  }[];
}

function keyOf(origin: Point, destination: Point, o: RouteOptions) {
  const p = (x: Point) => `${x.lat.toFixed(5)},${x.lng.toFixed(5)}`;
  const mode = o.vehicleType === 'MOTORCYCLE' ? 'bike' : 'car';
  return `${p(origin)}>${p(destination)}|${mode}|${o.alternatives ? 'alt' : ''}|${o.steps ? 'steps' : ''}|${(o.via ?? []).map(p).join(';')}`;
}

/**
 * Lộ trình thực tế giữa hai điểm (Google Routes API, tính theo giao thông hiện tại), kèm tình trạng
 * giao thông từng đoạn. Tuyến đầu tiên là tuyến Google đề xuất.
 */
export async function computeRoutes(origin: Point, destination: Point, options: RouteOptions = {}, signal?: AbortSignal): Promise<RouteInfo[]> {
  const key = keyOf(origin, destination, options);
  const hit = cache.get(key);
  if (hit) return hit;
  // Chỉ lấy các trường cần dùng: Routes API tính phí theo field mask.
  const fields = [
    'routes.distanceMeters',
    'routes.duration',
    'routes.staticDuration',
    'routes.routeLabels',
    'routes.polyline.encodedPolyline',
    'routes.travelAdvisory.speedReadingIntervals',
    ...(options.steps
      ? ['routes.legs.steps.distanceMeters', 'routes.legs.steps.staticDuration', 'routes.legs.steps.startLocation', 'routes.legs.steps.navigationInstruction']
      : []),
  ];
  const via = options.via ?? [];
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': fields.join(',') },
    body: JSON.stringify({
      origin: { location: latLng(origin) },
      destination: { location: latLng(destination) },
      ...(via.length ? { intermediates: via.map(p => ({ via: true, location: latLng(p) })) } : {}),
      travelMode: options.vehicleType === 'MOTORCYCLE' ? 'TWO_WHEELER' : 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      // Google không trả tuyến thay thế khi có điểm đi qua (intermediates).
      computeAlternativeRoutes: !!options.alternatives && via.length === 0,
      extraComputations: ['TRAFFIC_ON_POLYLINE'],
      languageCode: 'vi',
      regionCode: 'VN',
    }),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { routes?: ApiRoute[] };
  const routes = (data.routes ?? []).flatMap((r): RouteInfo[] => {
    const encodedPath = r.polyline?.encodedPolyline;
    if (!encodedPath) return [];
    const duration = seconds(r.duration);
    return [
      {
        encodedPath,
        distanceMeters: r.distanceMeters ?? 0,
        durationSeconds: duration,
        staticDurationSeconds: seconds(r.staticDuration) || duration,
        labels: r.routeLabels ?? [],
        speedIntervals: (r.travelAdvisory?.speedReadingIntervals ?? []).map(s => ({
          start: s.startPolylinePointIndex ?? 0,
          end: s.endPolylinePointIndex ?? 0,
          speed: SPEEDS.includes(s.speed as TrafficSpeed) ? (s.speed as TrafficSpeed) : 'NORMAL',
        })),
        steps: (r.legs ?? []).flatMap(leg =>
          (leg.steps ?? []).map(s => {
            const [instruction = '', ...notes] = (s.navigationInstruction?.instructions ?? '').split('\n').map(l => l.trim()).filter(Boolean);
            return {
              maneuver: s.navigationInstruction?.maneuver ?? 'STRAIGHT',
              instruction,
              notes,
              distanceMeters: s.distanceMeters ?? 0,
              durationSeconds: seconds(s.staticDuration),
              start: { lat: s.startLocation?.latLng?.latitude ?? 0, lng: s.startLocation?.latLng?.longitude ?? 0 },
            };
          }),
        ),
      },
    ];
  });
  if (routes.length) cache.set(key, routes);
  return routes;
}

/** Lộ trình đề xuất (tương thích chỗ gọi cũ). */
export async function computeRoute(origin: Point, destination: Point, signal?: AbortSignal): Promise<RouteInfo | null> {
  return (await computeRoutes(origin, destination, {}, signal))[0] ?? null;
}

/**
 * Hook: các lộ trình giữa hai điểm. `route` là tuyến đề xuất; `routes` gồm cả tuyến thay thế nếu yêu cầu.
 * Rỗng khi chưa đủ điểm hoặc không tính được (khi đó bản đồ vẽ đường thẳng).
 */
export function useRoute(origin: Point | null | undefined, destination: Point | null | undefined, options: RouteOptions = {}) {
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const key = origin && destination ? keyOf(origin, destination, options) : '';

  useEffect(() => {
    if (!MAPS_ENABLED || !origin || !destination) {
      setRoutes([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      computeRoutes(origin, destination, options, controller.signal)
        .then(r => setRoutes(r))
        .catch(() => setRoutes([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { route: routes[0] ?? null, routes, loading };
}

/** Số mét đường thông thoáng / chậm / tắc của một tuyến. */
export function trafficOf(route: RouteInfo) {
  const path = decodePolyline(route.encodedPath);
  const cum = cumulativeMeters(path);
  const total = cum[cum.length - 1] || route.distanceMeters;
  const meters = { NORMAL: 0, SLOW: 0, TRAFFIC_JAM: 0 } as Record<TrafficSpeed, number>;
  for (const s of route.speedIntervals) meters[s.speed] += Math.max(0, (cum[Math.min(s.end, cum.length - 1)] ?? 0) - (cum[Math.min(s.start, cum.length - 1)] ?? 0));
  // Đoạn Google không gắn tốc độ thì coi là thông thoáng.
  meters.NORMAL = Math.max(0, total - meters.SLOW - meters.TRAFFIC_JAM);
  return { total, ...meters };
}

/**
 * Nhãn gợi ý cho từng tuyến. Google chỉ phân biệt tuyến đề xuất / thay thế (nhãn "tiết kiệm nhiên liệu"
 * không hỗ trợ ở Việt Nam), nên nhanh nhất / ngắn nhất / ít kẹt xe được so sánh từ chính dữ liệu Google trả về.
 */
export function routeBadges(routes: RouteInfo[]) {
  const many = routes.length > 1;
  const congested = routes.map(r => {
    const t = trafficOf(r);
    return t.SLOW + t.TRAFFIC_JAM * 2;
  });
  const min = (values: number[]) => Math.min(...values);
  const unique = (values: number[], i: number) => values.filter(v => v === values[i]).length === 1;
  const fastest = min(routes.map(r => r.durationSeconds));
  const shortest = min(routes.map(r => r.distanceMeters));
  const calmest = min(congested);
  return routes.map((r, i) => {
    const badges: string[] = [];
    if (r.labels.includes('DEFAULT_ROUTE')) badges.push('Đề xuất');
    if (many && r.durationSeconds === fastest && unique(routes.map(x => x.durationSeconds), i)) badges.push('Nhanh nhất');
    if (many && r.distanceMeters === shortest && unique(routes.map(x => x.distanceMeters), i)) badges.push('Ngắn nhất');
    if (many && congested[i] === calmest && unique(congested, i)) badges.push('Ít kẹt xe nhất');
    return badges;
  });
}

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
}

export function formatDuration(s: number) {
  const minutes = Math.max(1, Math.round(s / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút` : `${minutes} phút`;
}
