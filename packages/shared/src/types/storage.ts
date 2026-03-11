import type { CatalogMeta, CatalogSummary, Catalog, CatalogStatus } from "./catalog";
import type { Country } from "./country";

export interface CatalogFilter {
  country?: string;
  store?: string;
  status?: CatalogStatus;
}

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
}
