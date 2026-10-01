import type { NextConfig } from "next";

const securityHeaders = [
  // Private records: never cache responses in shared or browser caches.
  { key: "Cache-Control", value: "no-store, max-age=0" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'self'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Uploads (max 10 MB file) go through server actions.
      bodySizeLimit: "11mb",
    },
    proxyClientMaxBodySize: "11mb",
  },
  async headers() {
    return [
      { source: "/:path((?!_next/static|_next/image).*)", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
