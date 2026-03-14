import { join } from "node:path";
import type { ReadonlyStorageAdapter } from "@bestdeal/shared";
import { FsReadAdapter } from "@bestdeal/shared/storage/fs";
import { R2ReadAdapter } from "@bestdeal/shared/storage/r2";

function createStorage(): ReadonlyStorageAdapter {
  if (process.env.R2_ENDPOINT) {
    return new R2ReadAdapter({
      endpoint: process.env.R2_ENDPOINT,
      bucket: process.env.R2_BUCKET ?? "bestdeal-catalogs",
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      publicUrl: process.env.R2_PUBLIC_URL ?? "",
    });
  }

  const DATA_DIR = join(process.cwd(), "../../data/catalogs");
  return new FsReadAdapter(DATA_DIR);
}

export const storage = createStorage();
