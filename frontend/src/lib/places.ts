import type { Point } from './types';

// Một số điểm ở Hà Nội để chọn nhanh; tọa độ có thể sửa tay trong ô nhập.
export const PLACES: { name: string; point: Point }[] = [
  { name: 'Học viện Bưu chính (Hà Đông)', point: { lat: 20.9809, lng: 105.7875 } },
  { name: 'Hồ Gươm', point: { lat: 21.0285, lng: 105.8542 } },
  { name: 'Sân vận động Mỹ Đình', point: { lat: 21.0205, lng: 105.764 } },
  { name: 'Times City', point: { lat: 20.9959, lng: 105.8686 } },
  { name: 'Ga Hà Nội', point: { lat: 21.0245, lng: 105.8412 } },
];
