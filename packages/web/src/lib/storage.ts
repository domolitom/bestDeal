import type { ReadonlyStorageAdapter } from "@bestdeal/shared";
import { R2ReadAdapter } from "@bestdeal/shared/storage/r2";

let _storage: ReadonlyStorageAdapter | null = null;

function getStorage(): ReadonlyStorageAdapter {
  if (_storage) return _storage;

  if (process.env.R2_ENDPOINT) {
    _storage = new R2ReadAdapter({
      endpoint: process.env.R2_ENDPOINT,
      bucket: process.env.R2_BUCKET ?? "bestdeal-catalogs",
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      publicUrl: process.env.R2_PUBLIC_URL ?? "",
    });
    return _storage;
  }

  throw new Error(
    "R2_ENDPOINT not set. For local dev without R2, use: source .env.local && bun run dev"
  );
}

// Lazy proxy — getStorage() only called when a method is actually invoked
export const storage = new Proxy({} as ReadonlyStorageAdapter, {
  get(_, prop) {
    return (...args: unknown[]) => {
      const s = getStorage();
      return (s as any)[prop](...args);
    };
  },
});
