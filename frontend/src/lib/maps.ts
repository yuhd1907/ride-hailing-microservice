// Cấu hình Google Maps Platform. Key được nhúng vào trang (bắt buộc với Maps JavaScript API),
// nên phải giới hạn key theo HTTP referrer và theo API trong Google Cloud Console.
export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
// Advanced Marker cần Map ID; DEMO_MAP_ID là Map ID Google cấp sẵn để phát triển.
export const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || 'DEMO_MAP_ID';
export const MAPS_ENABLED = GOOGLE_MAPS_API_KEY.length > 0;
