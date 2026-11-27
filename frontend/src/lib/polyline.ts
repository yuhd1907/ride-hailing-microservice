import type { Point } from './types';

/** Giải mã Google encoded polyline (độ chính xác 1e-5) thành danh sách tọa độ. */
export function decodePolyline(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Khoảng cách đường chim bay giữa hai điểm, đơn vị mét. */
export function metersBetween(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Quãng đường cộng dồn tới từng điểm của lộ trình (mét). */
export function cumulativeMeters(path: Point[]) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + metersBetween(path[i - 1], path[i]));
  return cum;
}

/** Điểm của lộ trình gần vị trí nhất (chỉ số và khoảng cách tới đó, mét). */
export function nearestOnPath(path: Point[], p: Point, from = 0) {
  let index = from;
  let meters = Infinity;
  for (let i = from; i < path.length; i++) {
    const d = metersBetween(path[i], p);
    if (d < meters) {
      meters = d;
      index = i;
    }
  }
  return { index, meters };
}
