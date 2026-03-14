import type { NextConfig } from "next";

const isR2 = !!process.env.R2_ENDPOINT;

const nextConfig: NextConfig = {
  // Allow images from the data directory and R2
  images: {
    unoptimized: true,
  },
  // Transpile shared package (types + utils barrel)
  transpilePackages: ["@bestdeal/shared"],
  // Externalize storage adapters on the server (they use node:fs / @aws-sdk)
  serverExternalPackages: ["@aws-sdk/client-s3"],
  // Only serve local images when not using R2
  ...(!isR2 && {
    async rewrites() {
      return [
        {
          source: "/data/catalogs/:path*",
          destination: "/api/images/:path*",
        },
      ];
    },
  }),
};

export default nextConfig;
