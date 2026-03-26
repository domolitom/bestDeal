import type {
  ReadonlyStorageAdapter,
  CatalogFilter,
} from "../types/storage";
import type {
  CatalogSummary,
  Catalog,
  CatalogMeta,
  CatalogPage,
} from "../types/catalog";
import type { Country } from "../types/country";
import { COUNTRY_META, COUNTRY_CODE_ALIASES } from "../types/country";
import { parseCatalogId } from "../utils/config-id";

/**
 * Manifest written by the scraper after each run.
 * Lists all catalogs with their metadata — avoids needing S3 ListObjects.
 */
export interface CdnManifest {
  updatedAt: string;
  catalogs: CatalogMeta[];
}

/** Validate that a parsed JSON value is a well-formed CdnManifest. */
export function isCdnManifest(value: unknown): value is CdnManifest {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.updatedAt !== "string") return false;
  if (!Array.isArray(obj.catalogs)) return false;
  // Spot-check first entry if present
  if (obj.catalogs.length > 0 && !isCatalogMeta(obj.catalogs[0])) return false;
  return true;
}

/**
 * Normalise a country string from manifest data to a canonical COUNTRY_META key.
 * Handles legacy data stored under incorrect country names (e.g. "united-kingdom" → "uk").
 */
export function normaliseCountryCode(raw: string): string {
  return COUNTRY_CODE_ALIASES[raw] ?? raw;
}

/** Validate that a parsed JSON value looks like a CatalogMeta. */
export function isCatalogMeta(value: unknown): value is CatalogMeta {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.store === "string" &&
    typeof obj.country === "string" &&
    typeof obj.status === "string" &&
    typeof obj.pageCount === "number"
  );
}

/**
 * CDN-based read adapter that fetches data via HTTP from a public CDN URL.
 * No AWS SDK needed — works on any runtime including Cloudflare Edge.
 *
 * Reads:
 *   {cdnUrl}/manifest.json        — catalog index
 *   {cdnUrl}/{country}/{store}/{catalogId}/meta.json  — individual catalog
 *   {cdnUrl}/{country}/{store}/{catalogId}/pages/page-001.jpg — images
 */
export class CdnReadAdapter implements ReadonlyStorageAdapter {
  private cdnUrl: string;
  private manifestCache: CdnManifest | null = null;
  private manifestFetchedAt = 0;
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(cdnUrl: string) {
    this.cdnUrl = cdnUrl.replace(/\/$/, "");
  }

  private async getManifest(): Promise<CdnManifest> {
    const now = Date.now();
    if (this.manifestCache && now - this.manifestFetchedAt < this.CACHE_TTL_MS) {
      return this.manifestCache;
    }

    const countries = Object.keys(COUNTRY_META);
    const results = await Promise.allSettled(
      countries.map(async (c) => {
        const resp = await fetch(`${this.cdnUrl}/${c}/manifest.json`);
        if (!resp.ok) return null;
        const data: unknown = await resp.json();
        if (!isCdnManifest(data)) return null;
        return data;
      })
    );

    let latestUpdatedAt = "";
    const allCatalogs: CatalogMeta[] = [];

    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const m = result.value;
      if (m.updatedAt > latestUpdatedAt) latestUpdatedAt = m.updatedAt;
      // Normalise country codes in case legacy data uses a different form (e.g. "united-kingdom")
      allCatalogs.push(
        ...m.catalogs.map((cat) => ({
          ...cat,
          country: normaliseCountryCode(cat.country),
        }))
      );
    }

    this.manifestCache = { updatedAt: latestUpdatedAt, catalogs: allCatalogs };
    this.manifestFetchedAt = now;
    return this.manifestCache;
  }

  async listCatalogs(filter?: CatalogFilter): Promise<CatalogSummary[]> {
    const manifest = await this.getManifest();
    let catalogs = manifest.catalogs;

    if (filter?.country) {
      catalogs = catalogs.filter((c) => c.country === filter.country);
    }
    if (filter?.store) {
      catalogs = catalogs.filter((c) => c.store === filter.store);
    }
    if (filter?.status) {
      catalogs = catalogs.filter((c) => c.status === filter.status);
    }

    return catalogs
      .map((c) => ({
        id: c.id,
        store: c.store,
        country: c.country,
        status: c.status,
        dateFrom: c.dateFrom,
        dateTo: c.dateTo,
        catalogType: c.catalogType,
        coverImage: c.coverImage,
        pageCount: c.pageCount,
      }))
      .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
  }

  async getCatalog(id: string): Promise<Catalog | null> {
    const parsed = parseCatalogId(id);
    if (!parsed) return null;

    const metaUrl = `${this.cdnUrl}/${parsed.country}/${parsed.store}/${id}/meta.json`;
    const resp = await fetch(metaUrl);
    if (!resp.ok) return null;

    const data: unknown = await resp.json();
    if (!isCatalogMeta(data)) return null;
    const meta = data;

    // Build pages array from pageCount
    const pages: CatalogPage[] = [];
    for (let i = 1; i <= meta.pageCount; i++) {
      const filename = `page-${String(i).padStart(3, "0")}.jpg`;
      pages.push({
        number: i,
        imageUrl: this.getImageUrl(id, `pages/${filename}`),
        filename,
      });
    }

    return { ...meta, pages };
  }

  getImageUrl(catalogId: string, filename: string): string {
    const parsed = parseCatalogId(catalogId);
    if (!parsed) return "";
    return `${this.cdnUrl}/${parsed.country}/${parsed.store}/${catalogId}/${filename}`;
  }

  async listCountries(): Promise<Country[]> {
    const manifest = await this.getManifest();
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const countryMap = new Map<string, { stores: Set<string>; catalogs: number }>();

    for (const cat of manifest.catalogs) {
      if (!countryMap.has(cat.country)) {
        countryMap.set(cat.country, { stores: new Set(), catalogs: 0 });
      }
      const entry = countryMap.get(cat.country)!;
      entry.stores.add(cat.store);
      // Only count catalogs that are ready and not yet expired
      if (cat.status === "ready" && cat.dateTo >= today) {
        entry.catalogs++;
      }
    }

    const countries: Country[] = [];
    for (const [name, counts] of countryMap) {
      const meta = COUNTRY_META[name];
      countries.push({
        code: name,
        name: meta?.name ?? name,
        flag: meta?.flag ?? "",
        storeCount: counts.stores.size,
        catalogCount: counts.catalogs,
      });
    }

    return countries;
  }

  async listStores(country: string): Promise<string[]> {
    const manifest = await this.getManifest();
    const stores = new Set<string>();
    for (const cat of manifest.catalogs) {
      if (cat.country === country) {
        stores.add(cat.store);
      }
    }
    return [...stores].sort();
  }
}
