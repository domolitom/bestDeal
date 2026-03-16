import type { CatalogMeta, CatalogSummary, Catalog, CatalogStatus } from "./catalog";
import type { Country } from "./country";

export interface CatalogFilter {
  country?: string;
  store?: string;
  status?: CatalogStatus;
}

/**
 * Read-only storage contract.
 *
 * - `listCatalogs` never throws — returns `[]` on failure.
 * - `getCatalog` returns `null` when the catalog does not exist.
 * - `listCountries` / `listStores` never throw — return `[]` on failure.
 */
export interface ReadonlyStorageAdapter {
  listCatalogs(filter?: CatalogFilter): Promise<CatalogSummary[]>;
  getCatalog(id: string): Promise<Catalog | null>;
  getImageUrl(catalogId: string, filename: string): string;
  listCountries(): Promise<Country[]>;
  listStores(country: string): Promise<string[]>;
}

export interface StorageAdapter extends ReadonlyStorageAdapter {
  writeCatalogMeta(meta: CatalogMeta): Promise<void>;
  writeImage(catalogId: string, filename: string, data: Buffer): Promise<void>;

  /** Write a manifest JSON file. Optional — only R2 and filesystem adapters implement this. */
  writeManifest?(json: string, country?: string): Promise<void>;
  /** Delete all data for a catalog. Optional — only R2 and filesystem adapters implement this. */
  deleteCatalog?(catalogId: string): Promise<void>;
}
