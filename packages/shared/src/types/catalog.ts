export type CatalogStatus = "discovered" | "scraping" | "ready" | "expired" | "failed";

export interface CatalogPage {
  number: number;
  imageUrl: string;
  filename: string; // "page-001.jpg"
}

export interface CatalogMeta {
  id: string; // "ro-lidl-2026-02-09-2026-02-15"
  store: string; // "lidl"
  country: string; // "romania"
  status: CatalogStatus;
  dateFrom: string; // ISO 8601: "2026-02-09"
  dateTo: string; // ISO 8601: "2026-02-15"
  catalogType?: string; // "leaflet", "magazine", "wrapper"
  coverImage: string; // "cover.jpg"
  pageCount: number;
  discoveredAt: string; // ISO 8601 timestamp
  scrapedAt?: string; // ISO 8601 timestamp
}

export interface Catalog extends CatalogMeta {
  pages: CatalogPage[];
}

export interface CatalogSummary {
  id: string;
  store: string;
  country: string;
  status: CatalogStatus;
  dateFrom: string;
  dateTo: string;
  catalogType?: string;
  coverImage: string;
  pageCount: number;
}
