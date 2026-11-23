/** @type {import('next').NextConfig} */

// Trình duyệt gọi /gw/... trên chính server Next.js; Next.js chuyển tiếp sang API Gateway.
// Nhờ vậy trang và API cùng origin, không cần bật CORS ở Gateway.
const gatewayUrl = (process.env.GATEWAY_URL || 'http://localhost:8080').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [{ source: '/gw/:path*', destination: `${gatewayUrl}/:path*` }];
  },
};

export default nextConfig;
