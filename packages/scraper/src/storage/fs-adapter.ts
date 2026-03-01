import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  StorageAdapter,
  CatalogFilter,
  CatalogSummary,
  Catalog,
  CatalogMeta,
  CatalogPage,
  Country,
} from "@bestdeal/shared";
import { COUNTRY_META, parseCatalogId } from "@bestdeal/shared";

/**
 * Filesystem-based storage adapter.
 *
 * Data layout:
 *   {baseDir}/
 *     {country}/{store}/
 *       {catalogId}/
 *         meta.json
 *         cover.jpg
 *         pages/
 *           page-001.jpg
 *           page-002.jpg
 */
export class FilesystemAdapter implements StorageAdapter {
  constructor(private baseDir: string) {}

  async listCatalogs(filter?: CatalogFilter): Promise<CatalogSummary[]> {
    const results: CatalogSummary[] = [];

    let countries: string[];
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      countries = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }

    if (filter?.country) {
      countries = countries.filter((c) => c === filter.country);
    }

    for (const country of countries) {
      const countryPath = join(this.baseDir, country);
      let stores: string[];
      try {
        const entries = await readdir(countryPath, { withFileTypes: true });
        stores = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        continue;
      }

      if (filter?.store) {
        stores = stores.filter((s) => s === filter.store);
      }

      for (const store of stores) {
        const storePath = join(countryPath, store);
        let catalogDirs: string[];
        try {
          const entries = await readdir(storePath, { withFileTypes: true });
          catalogDirs = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        } catch {
          continue;
        }

        for (const catalogDir of catalogDirs) {
          const metaPath = join(storePath, catalogDir, "meta.json");
          try {
            const raw = await readFile(metaPath, "utf-8");
            const meta: CatalogMeta = JSON.parse(raw);

            if (filter?.status && meta.status !== filter.status) continue;

            results.push({
              id: meta.id,
              store: meta.store,
              country: meta.country,
              status: meta.status,
              dateFrom: meta.dateFrom,
              dateTo: meta.dateTo,
              catalogType: meta.catalogType,
              coverImage: meta.coverImage,
              pageCount: meta.pageCount,
            });
          } catch {
            // Skip catalogs without valid meta.json
          }
        }
      }
    }

    // Sort by dateFrom descending (newest first)
    results.sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
    return results;
  }

  async getCatalog(id: string): Promise<Catalog | null> {
    const parsed = parseCatalogId(id);
    if (!parsed) return null;

    const catalogPath = this.getCatalogPath(id);
    const metaPath = join(catalogPath, "meta.json");

    let meta: CatalogMeta;
    try {
      const raw = await readFile(metaPath, "utf-8");
      meta = JSON.parse(raw);
    } catch {
      return null;
    }

    // Scan pages directory
    const pagesDir = join(catalogPath, "pages");
    let pageFiles: string[];
    try {
      const entries = await readdir(pagesDir);
      pageFiles = entries
        .filter((f) => f.match(/^page-\d+\.jpg$/))
        .sort();
    } catch {
      pageFiles = [];
    }

    const pages: CatalogPage[] = pageFiles.map((f, i) => {
      const num = parseInt(f.match(/page-(\d+)/)?.[1] || String(i + 1), 10);
      return {
        number: num,
        imageUrl: this.getImageUrl(id, `pages/${f}`),
        filename: f,
      };
    });

    return { ...meta, pages };
  }

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
    // If filename is just "cover.jpg" or "page-001.jpg", place in appropriate location
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

  getImageUrl(catalogId: string, filename: string): string {
    const parsed = parseCatalogId(catalogId);
    if (!parsed) return "";
    // Returns a relative path that the web server can serve
    return `/data/catalogs/${parsed.country}/${parsed.store}/${catalogId}/${filename}`;
  }

  async listCountries(): Promise<Country[]> {
    const countries: Country[] = [];

    let dirs: string[];
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }

    for (const dir of dirs) {
      const meta = COUNTRY_META[dir];
      const countryPath = join(this.baseDir, dir);

      let storeCount = 0;
      let catalogCount = 0;

      try {
        const storeEntries = await readdir(countryPath, {
          withFileTypes: true,
        });
        const storeDirs = storeEntries.filter((e) => e.isDirectory());
        storeCount = storeDirs.length;

        for (const storeDir of storeDirs) {
          const storePath = join(countryPath, storeDir.name);
          const catalogEntries = await readdir(storePath, {
            withFileTypes: true,
          });
          catalogCount += catalogEntries.filter((e) =>
            e.isDirectory()
          ).length;
        }
      } catch {
        // directory might not have stores yet
      }

      countries.push({
        code: dir,
        name: meta?.name ?? dir,
        flag: meta?.flag ?? "",
        storeCount,
        catalogCount,
      });
    }

    return countries;
  }

  async listStores(country: string): Promise<string[]> {
    const countryPath = join(this.baseDir, country);
    try {
      const entries = await readdir(countryPath, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /** Get the filesystem path for a catalog directory */
  private getCatalogPath(catalogId: string): string {
    const parsed = parseCatalogId(catalogId);
    if (!parsed) {
      throw new Error(`Invalid catalog ID: ${catalogId}`);
    }
    return join(this.baseDir, parsed.country, parsed.store, catalogId);
  }
}
