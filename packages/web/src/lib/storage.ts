import type { ReadonlyStorageAdapter } from "@bestdeal/shared";
import { CdnReadAdapter } from "@bestdeal/shared/storage/cdn";

function createStorage(): ReadonlyStorageAdapter {
  const cdnUrl = process.env.NEXT_PUBLIC_CDN_URL || process.env.R2_PUBLIC_URL;
  if (cdnUrl) {
    return new CdnReadAdapter(cdnUrl);
  }

  throw new Error(
    "NEXT_PUBLIC_CDN_URL not set. For local dev, use: source .env.local && bun run dev"
  );
}

// Lazy proxy — createStorage() only called when a method is actually invoked
let _storage: ReadonlyStorageAdapter | null = null;
export const storage = new Proxy({} as ReadonlyStorageAdapter, {
  get(_, prop) {
    return (...args: unknown[]) => {
      if (!_storage) _storage = createStorage();
      return (_storage as any)[prop](...args);
    };
  },
});
