import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No other site may show these pages in a frame (clickjacking could bypass the same-origin and device rules).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
