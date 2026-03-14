import type { ReadonlyStorageAdapter } from "@bestdeal/shared";
import { R2ReadAdapter } from "@bestdeal/shared/storage/r2";

function createStorage(): ReadonlyStorageAdapter {
  // R2 mode (production on Cloudflare + local dev with R2 env vars)
  if (process.env.R2_ENDPOINT) {
    return new R2ReadAdapter({
      endpoint: process.env.R2_ENDPOINT,
      bucket: process.env.R2_BUCKET ?? "bestdeal-catalogs",
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      publicUrl: process.env.R2_PUBLIC_URL ?? "",
    });
  }

  // Filesystem fallback for local dev (loaded at packages/web/src/lib/storage-local.ts)
  throw new Error(
    "R2_ENDPOINT not set. For local dev without R2, use: source .env.local && bun run dev"
  );
}

export const storage = createStorage();
