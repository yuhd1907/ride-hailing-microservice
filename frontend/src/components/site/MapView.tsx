'use client';

import { AdvancedMarker, Map as GoogleMap, Pin, Polyline, Rectangle, useMap } from '@vis.gl/react-google-maps';
import { MapPinOff } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { GOOGLE_MAP_ID, MAPS_ENABLED } from '@/lib/maps';
import { decodePolyline } from '@/lib/polyline';
import type { SpeedInterval, TrafficSpeed } from '@/lib/routes';
import type { Point } from '@/lib/types';

/** Một lộ trình để vẽ: tuyến đang chọn tô màu theo giao thông, tuyến khác màu xám, bấm để chọn. */
export interface MapRoute {
  id: string;
  encodedPath: string;
  selected: boolean;
  /** Có thì tô xanh/vàng/đỏ theo từng đoạn; không có thì vẽ một màu. */
  speedIntervals?: SpeedInterval[];
}

export const TRAFFIC_COLOR: Record<TrafficSpeed, string> = { NORMAL: '#16a34a', SLOW: '#f59e0b', TRAFFIC_JAM: '#dc2626' };

export type MarkerKind = 'pickup' | 'destination' | 'me' | 'bike' | 'car';

export interface MapMarker {
  id: string;
  position: Point;
  kind: MarkerKind;
  label?: string;
  /** Cho phép kéo ghim để chỉnh vị trí chính xác. */
  draggable?: boolean;
}

/** Ô tô màu trên bản đồ (bản đồ nhu cầu): tự vẽ bằng Rectangle. */
export interface MapCell {
  id: string;
  bounds: { north: number; south: number; east: number; west: number };
  color: string;
  opacity: number;
}

const STYLE: Record<MarkerKind, { background: string; glyph: string }> = {
  pickup: { background: '#000000', glyph: 'A' },
  destination: { background: '#e11d48', glyph: 'B' },
  me: { background: '#7c3aed', glyph: '●' },
  // Tài xế: xe máy / ô tô (tài xế rảnh quanh điểm đón, hoặc tài xế của chuyến đang tới).
  bike: { background: '#059669', glyph: '🛵' },
  car: { background: '#0f766e', glyph: '🚗' },
};

function FitTo({ points }: { points: Point[] }) {
  const map = useMap();
  const key = points.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.panTo(points[0]);
      if ((map.getZoom() ?? 0) < 15) map.setZoom(16);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, 64);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

function RouteLine({ route, onClick }: { route: MapRoute; onClick?: () => void }) {
  const path = useMemo(() => decodePolyline(route.encodedPath), [route.encodedPath]);
  if (!route.selected) {
    // Tuyến thay thế: xám, nằm dưới tuyến đang chọn; bấm vào để chọn tuyến này.
    return (
      <>
        <Polyline path={path} strokeColor="#ffffff" strokeOpacity={1} strokeWeight={9} zIndex={1} clickable={!!onClick} onClick={onClick} />
        <Polyline path={path} strokeColor="#94a3b8" strokeOpacity={1} strokeWeight={6} zIndex={2} clickable={!!onClick} onClick={onClick} />
      </>
    );
  }
  const intervals = route.speedIntervals;
  return (
    <>
      {/* Viền trắng giúp lộ trình nổi trên nền bản đồ; lớp nền xanh (hoặc đen nếu không có dữ liệu giao thông). */}
      <Polyline path={path} strokeColor="#ffffff" strokeOpacity={1} strokeWeight={10} zIndex={3} />
      <Polyline path={path} strokeColor={intervals?.length ? TRAFFIC_COLOR.NORMAL : '#000000'} strokeOpacity={1} strokeWeight={6} zIndex={4} />
      {/* Đoạn chậm / tắc vẽ đè lên lớp nền. */}
      {intervals
        ?.filter(s => s.speed !== 'NORMAL' && s.end > s.start)
        .map(s => (
          <Polyline key={`${s.start}-${s.end}`} path={path.slice(s.start, s.end + 1)} strokeColor={TRAFFIC_COLOR[s.speed]} strokeOpacity={1} strokeWeight={6} zIndex={5} />
        ))}
    </>
  );
}

export function MapsUnavailable() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-100 px-6 text-center">
      <MapPinOff className="h-8 w-8 text-slate-400" />
      <div className="text-sm font-medium text-slate-600">Bản đồ chưa được cấu hình</div>
      <div className="max-w-sm text-xs text-slate-500">
        Đặt <code className="font-mono">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> trong <code className="font-mono">frontend/.env.local</code> rồi khởi động lại.
      </div>
    </div>
  );
}

export default function MapView({
  center,
  markers,
  route,
  routePath,
  routes,
  onRouteClick,
  fit = [],
  cells = [],
  onCellClick,
  onClick,
  onMarkerDragEnd,
  className = 'h-full w-full',
}: {
  cells?: MapCell[];
  onCellClick?: (id: string) => void;
  center: Point;
  markers: MapMarker[];
  route?: [Point, Point] | null;
  /** Lộ trình theo đường phố (Routes API); thiếu thì vẽ đường thẳng nét đứt giữa hai điểm của `route`. */
  routePath?: string | null;
  /** Nhiều lộ trình (tuyến đang chọn + tuyến thay thế); có thì dùng thay cho `routePath`. */
  routes?: MapRoute[];
  onRouteClick?: (id: string) => void;
  fit?: Point[];
  onClick?: (p: Point) => void;
  onMarkerDragEnd?: (id: string, p: Point) => void;
  className?: string;
}) {
  if (!MAPS_ENABLED) return <MapsUnavailable />;
  return (
    <GoogleMap
      className={className}
      mapId={GOOGLE_MAP_ID}
      defaultCenter={{ lat: center.lat, lng: center.lng }}
      defaultZoom={14}
      gestureHandling="greedy"
      disableDefaultUI
      zoomControl
      clickableIcons={false}
      onClick={e => {
        const latLng = e.detail.latLng;
        if (onClick && latLng) onClick({ lat: Number(latLng.lat.toFixed(6)), lng: Number(latLng.lng.toFixed(6)) });
      }}
    >
      <FitTo points={fit} />
      {cells.map(c => (
        <Rectangle
          key={c.id}
          bounds={c.bounds}
          fillColor={c.color}
          fillOpacity={c.opacity}
          strokeColor={c.color}
          strokeOpacity={Math.min(0.9, c.opacity + 0.25)}
          strokeWeight={1}
          clickable={!!onCellClick}
          onClick={() => onCellClick?.(c.id)}
        />
      ))}
      {routes?.length ? (
        routes.map(r => <RouteLine key={`${r.id}-${r.selected}-${r.encodedPath.length}`} route={r} onClick={onRouteClick && !r.selected ? () => onRouteClick(r.id) : undefined} />)
      ) : routePath ? (
        <>
          {/* Viền trắng bên dưới giúp lộ trình nổi trên nền bản đồ. */}
          <Polyline key={`${routePath}-casing`} encodedPath={routePath} strokeColor="#ffffff" strokeOpacity={1} strokeWeight={9} zIndex={1} />
          <Polyline key={routePath} encodedPath={routePath} strokeColor="#000000" strokeOpacity={1} strokeWeight={5} zIndex={2} />
        </>
      ) : (
        route && (
          <Polyline
            path={route.map(p => ({ lat: p.lat, lng: p.lng }))}
            geodesic
            strokeOpacity={0}
            icons={[{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, strokeColor: '#000000', scale: 3 }, offset: '0', repeat: '14px' }]}
          />
        )
      )}
      {markers.map(m => (
        <AdvancedMarker
          key={m.id}
          position={{ lat: m.position.lat, lng: m.position.lng }}
          title={m.label}
          draggable={m.draggable}
          onDragEnd={e => {
            const latLng = e.latLng;
            if (latLng) onMarkerDragEnd?.(m.id, { lat: Number(latLng.lat().toFixed(6)), lng: Number(latLng.lng().toFixed(6)) });
          }}
        >
          <Pin background={STYLE[m.kind].background} borderColor="#ffffff" glyphColor="#ffffff" glyph={STYLE[m.kind].glyph} scale={m.kind === 'bike' || m.kind === 'car' ? 1 : 1.15} />
        </AdvancedMarker>
      ))}
    </GoogleMap>
  );
}
