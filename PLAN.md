# Plan: Catalog Aggregator — Multi-Country Retail Catalog Browser

## Context

The current `bestDeal` codebase works for 3 Romanian stores but has fundamental issues for a public multi-country product:
- **Web server and scraper are coupled** — the server can trigger scraping, which is dangerous in production
- **No proper data model** — catalogs are just folders of images with minimal metadata
- **Fragile image extraction** — hardcoded heuristics, not configurable per store
- **No SEO/SSR** — vanilla HTML frontend can't be indexed
- **No storage abstraction** — direct filesystem calls everywhere

**Goal:** Rebuild as a public web app that aggregates retail catalogs (grocery, electronics, furniture, drugstores) across multiple EU countries. Browse-only MVP, designed for future search/price comparison.

**What to keep from the existing codebase:**
- The JSON-based store config DSL (linkPatterns, datePatterns, urlTransforms)
- The discovery engine logic (discoverStore, parseDates, applyUrlTransforms)
- The exponential probe + binary search for page count detection
- The `stores/{country}/{store}.json` directory convention

---

## Architecture Overview

```
Turborepo Monorepo
├── packages/shared/     — TypeScript types + pure utilities
├── packages/scraper/    — Standalone CLI pipeline (Playwright + Bun)
└── packages/web/        — Next.js app (read-only, serves catalogs)
```

**Key principle:** The scraper writes data, the web app reads data. They never run in the same process. They share only the `shared` types package and a storage directory (filesystem or S3).

---

## Step 1: Set Up Monorepo

Create Turborepo monorepo with three packages:

```
catalog-aggregator/
  package.json              # Workspaces + turbo config
  turbo.json
  packages/
    shared/package.json
    scraper/package.json
    web/package.json
```

- **shared**: Zero dependencies, just types + pure functions
- **scraper**: Depends on `shared`, `playwright`
- **web**: Depends on `shared`, `next`, `react`

---

## Step 2: Shared Types & Utilities (`packages/shared/`)

### Core Data Model

```
packages/shared/src/
  types/
    catalog.ts    — CatalogMeta, CatalogPage, Catalog, CatalogSummary
    store.ts      — StoreDefinition, LinkPattern, DatePattern, etc.
    storage.ts    — StorageAdapter interface, CatalogFilter
    country.ts    — Country type
  utils/
    dates.ts      — Date parsing, formatting, freshness
    config-id.ts  — buildConfigId
  index.ts
```

**Key type changes from existing code:**
- Catalog IDs include country code: `ro-lidl-2026-02-09-2026-02-15` (not `lidl-09-02-15-02-2026`)
- Dates use ISO 8601: `"2026-02-09"` (not `"09-02"`)
- Catalog has a status lifecycle: `discovered → scraping → ready → expired | failed`
- StoreDefinition gains `displayName`, `logoPath`, `imageExtraction` (configurable per store), `delayBetweenPages`

### StorageAdapter Interface

```typescript
interface StorageAdapter {
  listCatalogs(filter?: CatalogFilter): Promise<CatalogSummary[]>;
  getCatalog(id: string): Promise<Catalog | null>;
  writeCatalogMeta(meta: CatalogMeta): Promise<void>;
  writeImage(catalogId: string, filename: string, data: Buffer): Promise<void>;
  getImageUrl(catalogId: string, filename: string): string;
  listCountries(): Promise<Country[]>;
  listStores(country: string): Promise<string[]>;
}
```

This abstraction lets us swap filesystem for S3/R2 later without touching scraper or web code.

---

## Step 3: Scraper Package (`packages/scraper/`)

### Structure

```
packages/scraper/
  stores/                    # Store config JSONs (carried from existing)
    romania/
      lidl.json
      kaufland.json
      penny.json
    germany/                 # New countries added here
      lidl.json
  src/
    config/store-loader.ts   # loadStoreDefinitions (from existing src/store-config.ts)
    discovery/
      discovery-engine.ts    # discoverStore, parseDates, etc. (from existing)
      discoverer.ts          # Orchestrates discovery for all stores
    scraping/
      resolver.ts            # Visits pages, extracts images (from existing)
      downloader.ts          # Downloads images (from existing)
      page-validator.ts      # findLastPage (from existing)
    storage/fs-adapter.ts    # Filesystem StorageAdapter implementation
    pipeline.ts              # Full pipeline: discover → resolve → download
    cli.ts                   # CLI entry point
  tests/
```

### Pipeline Flow

1. Load all store definitions from `stores/{country}/*.json`
2. For each store: visit landing page, discover catalog links, parse dates
3. Deduplicate against existing catalogs in storage
4. For each new catalog: probe page count, resolve image URLs, download images
5. Write `meta.json` per catalog, update status to `ready`
6. Generate pipeline run report

### CLI

```bash
bun run scraper              # Full pipeline (all countries, all stores)
bun run scraper --country=ro # Limit to Romania
bun run scraper --store=lidl --country=ro
bun run scraper --discover-only
bun run scraper --cleanup --max-age=30
```

### Data on Disk

```
data/catalogs/
  ro/lidl/
    ro-lidl-2026-02-24-2026-03-02/
      meta.json
      cover.jpg
      pages/
        page-001.jpg
        page-002.jpg
  de/lidl/
    ...
```

---

## Step 4: Web App (`packages/web/`)

### Next.js App Router — Pages

| Route | What it shows |
|-------|--------------|
| `/` | Homepage — country selector grid with flags + catalog counts |
| `/[country]` | Country page — all stores with current catalogs |
| `/[country]/[store]` | Store page — all catalogs for this store |
| `/[country]/[store]/[catalogId]` | Catalog viewer — browse pages |

### Key Components

- **`CountrySelector`** — Grid of country cards (flag, name, active catalog count)
- **`CatalogGrid`** — Responsive grid of CatalogCard components
- **`CatalogCard`** — Cover image, store logo, dates, active/expired badge
- **`CatalogViewer`** — Vertical scroll mode (default) + single-page mode toggle, lazy loading, keyboard nav, page thumbnail strip
- **`StoreSidebar`** — Store list on desktop, horizontal pills on mobile
- **`FreshnessIndicator`** — "Valid until Mar 2" / "Expired 3 days ago"

### API Routes (all read-only, no mutations)

| Endpoint | Returns |
|----------|---------|
| `GET /api/countries` | List of countries with store/catalog counts |
| `GET /api/stores?country=ro` | Stores for a country |
| `GET /api/catalogs?country=ro&store=lidl&status=ready` | Catalog summaries (filtered) |
| `GET /api/catalogs/:id` | Full catalog with page list |

### SSR Strategy

- List pages (home, country, store): **Server components** reading directly from StorageAdapter. ISR with 5-min revalidation.
- Catalog viewer: **Client component** for scroll tracking, keyboard nav, lazy loading.
- Static images served by nginx (production) or Next.js rewrites (dev).

---

## Step 5: Migrate Existing Code

1. Extract shared types into `packages/shared/`
2. Move `src/discovery-engine.ts`, `src/discoverer.ts`, `src/resolver.ts`, `src/downloader.ts` → `packages/scraper/src/`
3. Refactor scraper to write through `StorageAdapter` instead of direct `fs` calls
4. Move `stores/` directory into `packages/scraper/stores/`
5. Move and update tests
6. Build Next.js frontend (new code)
7. Delete old `src/server.ts` and `frontend/`

---

## Step 6: Testing

- **Unit tests**: Pure functions (date parsing, URL transforms, config ID generation, filtering)
- **Config validation**: All store JSONs validate against StoreDefinition schema (CI)
- **Integration tests**: Write test data to temp dir → verify API responses
- **E2E scraper tests**: Mock server serving fake catalog pages → full pipeline test

---

## Verification

1. `bun run scraper --country=ro` discovers and scrapes Romanian catalogs
2. `data/catalogs/ro/` contains meta.json + images for each catalog
3. `bun run dev` (in packages/web) shows catalogs at `localhost:3000`
4. Navigate: homepage → Romania → Lidl → browse a catalog
5. All existing tests pass after migration
6. New store can be added by dropping a JSON file (zero code changes)

---

## Implementation Order

1. ~~Monorepo setup (turbo, workspaces, tsconfig)~~ **DONE**
2. ~~Shared types + utilities~~ **DONE**
3. ~~Scraper: storage adapter (filesystem)~~ **DONE**
4. ~~Scraper: migrate discovery + scraping code~~ **DONE**
5. ~~Scraper: CLI + pipeline orchestration~~ **DONE**
6. Scraper: verify it works end-to-end for Romania
7. ~~Web: Next.js skeleton + routing~~ **DONE**
8. ~~Web: API routes + storage adapter (read-only)~~ **DONE**
9. ~~Web: Homepage + country page~~ **DONE**
10. ~~Web: Store page + catalog grid~~ **DONE**
11. ~~Web: Catalog viewer~~ **DONE**
12. Delete old code

---

## Progress Notes

### What's been completed
- Turborepo monorepo with 3 packages (`shared`, `scraper`, `web`)
- All shared types and utilities (ISO dates, catalog IDs, StorageAdapter interface)
- Full scraper package: discovery engine, resolver, downloader, filesystem adapter, pipeline, CLI
- 48 tests passing across 5 test files
- All 3 packages typecheck clean
- Next.js 15 app with App Router: 4 page routes + 5 API routes + image serving
- Components: CountrySelector, CatalogGrid, CatalogCard, CatalogViewer (scroll + single-page modes), FreshnessIndicator, Header with breadcrumbs
- Next.js production build succeeds

### What's remaining
- **Step 6**: Run `bun run scraper --country=romania` to verify end-to-end discovery + scraping works with the new pipeline against live Romanian store sites
- **Step 12**: Delete old legacy code (`src/`, `frontend/`, root `stores/`, `configs/`, `start.sh`) and remove `:old` scripts from root package.json
- **Integration tests**: Write test data to temp dir → verify web API responses
- **E2E scraper tests**: Mock server → full pipeline test
- **Config validation CI**: Validate store JSONs against StoreDefinition schema
