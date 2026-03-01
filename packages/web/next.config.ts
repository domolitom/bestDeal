import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serve catalog images from the data directory
  async rewrites() {
    return [
      {
        source: "/data/catalogs/:path*",
        destination: "/api/images/:path*",
      },
    ];
  },
  // Allow images from the data directory
  images: {
    unoptimized: true,
  },
  // Transpile shared package
  transpilePackages: ["@bestdeal/shared"],
};

export default nextConfig;
