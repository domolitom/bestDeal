import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StorageAdapter, CatalogMeta } from "@bestdeal/shared";
import { FsReadAdapter } from "@bestdeal/shared/storage/fs";

/**
 * Read-write filesystem storage adapter for the scraper.
 * Inherits all read operations from FsReadAdapter and adds write methods.
 */
export class FilesystemAdapter extends FsReadAdapter implements StorageAdapter {
  async writeCatalogMeta(meta: CatalogMeta): Promise<void> {
    const catalogPath = this.getCatalogPath(meta.id);
    await mkdir(join(catalogPath, "pages"), { recursive: true });
    const metaPath = join(catalogPath, "meta.json");
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
  }

  async writeImage(
    catalogId: string,
    filename: string,
    data: Buffer
  ): Promise<void> {
    const catalogPath = this.getCatalogPath(catalogId);
    let filePath: string;
    if (filename.startsWith("page-")) {
      filePath = join(catalogPath, "pages", filename);
      await mkdir(join(catalogPath, "pages"), { recursive: true });
    } else {
      filePath = join(catalogPath, filename);
      await mkdir(catalogPath, { recursive: true });
    }
    await writeFile(filePath, data);
  }
}
