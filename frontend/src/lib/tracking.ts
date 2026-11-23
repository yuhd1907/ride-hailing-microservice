'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Point } from './types';

export interface GpsFix extends Point {
  accuracy: number;
  at: number;
}

const MIN_MOVE_METERS = 15; // di chuyển tối thiểu để gửi vị trí mới
const HEARTBEAT_MS = 20_000; // đứng yên vẫn gửi lại; Driver Service bỏ vị trí cũ hơn 300 giây
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };

function meters(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function toFix(pos: GeolocationPosition): GpsFix {
  return {
    lat: Number(pos.coords.latitude.toFixed(6)),
    lng: Number(pos.coords.longitude.toFixed(6)),
    accuracy: Math.round(pos.coords.accuracy),
    at: pos.timestamp,
  };
}

export function gpsErrorMessage(error: GeolocationPositionError | null) {
  if (!error) return null;
  if (error.code === error.PERMISSION_DENIED) return 'Bạn chưa cho phép ứng dụng truy cập vị trí. Hãy bật quyền vị trí cho trang này trong trình duyệt.';
  if (error.code === error.POSITION_UNAVAILABLE) return 'Không xác định được vị trí. Kiểm tra GPS / dịch vụ định vị của thiết bị.';
  return 'Tín hiệu GPS yếu, đang thử lại…';
}

/**
 * Theo dõi vị trí tài xế khi đang trực tuyến.
 * - acquire(): lấy một vị trí GPS chính xác ngay lúc bật nhận cuốc.
 * - Khi active: watchPosition liên tục, gửi vị trí lên Driver Service khi di chuyển ≥ 15 m
 *   hoặc sau mỗi 20 giây. Khi active = false (tài xế tắt nhận cuốc) thì dừng theo dõi.
 */
export function useDriverTracking(active: boolean, send: (p: Point) => Promise<boolean>) {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [lastSent, setLastSent] = useState<number | null>(null);
  const [error, setError] = useState<GeolocationPositionError | null>(null);
  const latest = useRef<GpsFix | null>(null);
  const sent = useRef<{ point: Point; at: number } | null>(null);
  const sending = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  const push = useCallback(async (point: GpsFix, force = false) => {
    const previous = sent.current;
    const due = force || !previous || meters(previous.point, point) >= MIN_MOVE_METERS || Date.now() - previous.at >= HEARTBEAT_MS;
    if (!due || sending.current) return;
    sending.current = true;
    try {
      if (await sendRef.current(point)) {
        sent.current = { point, at: Date.now() };
        setLastSent(Date.now());
      }
    } finally {
      sending.current = false;
    }
  }, []);

  const acquire = useCallback(
    () =>
      new Promise<GpsFix | null>(resolve => {
        if (!('geolocation' in navigator)) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          pos => {
            const f = toFix(pos);
            latest.current = f;
            setFix(f);
            setError(null);
            resolve(f);
          },
          err => {
            setError(err);
            resolve(null);
          },
          GPS_OPTIONS,
        );
      }),
    [],
  );

  /** Ghi nhận vị trí đã được gửi bên ngoài hook (lúc bật nhận cuốc). */
  const markSent = useCallback((point: Point) => {
    sent.current = { point, at: Date.now() };
    setLastSent(Date.now());
  }, []);

  useEffect(() => {
    if (!active || !('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        const f = toFix(pos);
        latest.current = f;
        setFix(f);
        setError(null);
        void push(f);
      },
      err => setError(err),
      GPS_OPTIONS,
    );
    // Thiết bị đứng yên có thể không phát sự kiện mới: vẫn gửi lại vị trí gần nhất định kỳ.
    const heartbeat = window.setInterval(() => latest.current && void push(latest.current), HEARTBEAT_MS);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeat);
    };
  }, [active, push]);

  return { fix, lastSent, error, acquire, markSent };
}
