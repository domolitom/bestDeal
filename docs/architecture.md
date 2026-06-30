# Architecture Overview

This document describes the high-level architecture of the bestDeal project — a multi-country retail catalog aggregator that scrapes store catalogs as images and serves them through a web application.

## Table of Contents

- [System Overview](#system-overview)
- [Monorepo Structure](#monorepo-structure)
- [Package Dependency Graph](#package-dependency-graph)
- [The Shared Package](#the-shared-package)
- [The Scraper Package](#the-scraper-package)
- [The Web Package](#the-web-package)
- [Data Flow](#data-flow)
- [Storage Architecture](#storage-architecture)
- [Deployment Architecture](#deployment-architecture)
- [Key Design Decisions](#key-design-decisions)

---

## System Overview

bestDeal consists of three independent concerns:

1. **Scraping** — A CLI pipeline that discovers retail catalogs from store websites, resolves their page images using platform-specific resolvers, downloads the images, and uploads them to cloud storage (Cloudflare R2).

2. **Storage** — A Cloudflare R2 bucket that stores catalog metadata and page images, fronted by a CDN at `cdn.best-deal-shops.com`. Each catalog is a folder containing a `meta.json` file and numbered page images.

3. **Serving** — A Next.js 15 web application deployed on Cloudflare Pages that reads catalog data from the CDN and presents it to users. The web app is entirely read-only.

**Critical principle:** The scraper writes data. The web app reads data. They never run in the same process and share no runtime dependencies beyond the `@bestdeal/shared` type package.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Scraper CLI    │────>│  Cloudflare R2   │<────│   Next.js Web   │
│  (GitHub Actions │     │  (S3-compatible)  │     │  (Cloudflare    │
│   Mon+Thu 6am)   │     │                  │     │   Pages, Edge)  │
└─────────────────┘     │  cdn.best-deal-   │     └─────────────────┘
                        │  shops.com        │
                        └──────────────────┘
```

## Monorepo Structure

The project uses a Turborepo monorepo with Bun as the package manager and runtime:

```
bestdeal/
├── package.json              # Root workspace config
├── turbo.json                # Turborepo task pipeline
├── wrangler.toml             # Cloudflare Pages config
├── bun.lockb                 # Bun lockfile
│
├── .github/
│   └── workflows/
│       ├── scrape.yml        # Scraper cron (Mon + Thu 6am UTC)
│       ├── cleanup.yml       # Delete expired catalogs (daily midnight)
│       └── test.yml          # CI test pipeline
│
├── packages/
│   ├── shared/               # Types, utilities, read-only storage adapters
│   │   ├── src/
│   │   │   ├── index.ts          # Barrel export (client-safe)
│   │   │   ├── types/
│   │   │   │   ├── catalog.ts    # CatalogMeta, Catalog, CatalogStatus, etc.
│   │   │   │   ├── store.ts      # StoreDefinition, LinkPattern, DatePattern, etc.
│   │   │   │   ├── storage.ts    # StorageAdapter, ReadonlyStorageAdapter interfaces
│   │   │   │   └── country.ts    # Country type, COUNTRY_META lookup
│   │   │   ├── utils/
│   │   │   │   ├── dates.ts      # Date parsing, ISO conversion, freshness
│   │   │   │   ├── config-id.ts  # buildCatalogId, parseCatalogId
│   │   │   │   └── url-transforms.ts  # URL normalization utilities
│   │   │   └── storage/
│   │   │       ├── r2-read-adapter.ts   # S3-compatible read adapter
│   │   │       ├── cdn-read-adapter.ts  # HTTP/CDN read adapter (edge-safe)
│   │   │       └── fs-read-adapter.ts   # Filesystem read adapter (local dev)
│   │   └── package.json
│   │
│   ├── scraper/              # CLI scraping pipeline
│   │   ├── src/
│   │   │   ├── cli.ts            # CLI entry point (arg parsing, storage setup)
│   │   │   ├── pipeline.ts       # Main pipeline orchestration
│   │   │   ├── logger.ts         # Structured logger (JSON in CI, pretty locally)
│   │   │   ├── browser.ts        # Playwright + Stealth plugin setup
│   │   │   ├── cleanup.ts        # Cleanup expired/failed catalogs from R2
│   │   │   ├── config/
│   │   │   │   └── store-loader.ts   # Load store JSON configs from disk
│   │   │   ├── discovery/
│   │   │   │   ├── discoverer.ts     # Top-level discovery orchestrator
│   │   │   │   └── discovery-engine.ts  # Page-level catalog discovery
│   │   │   ├── scraping/
│   │   │   │   ├── resolver-registry.ts  # Resolver registry + auto-detection
│   │   │   │   ├── resolver-types.ts     # ResolvedPage, ResolveResult
│   │   │   │   ├── resolver.ts           # Browser (screenshot) resolver
│   │   │   │   ├── leaflets-api-resolver.ts
│   │   │   │   ├── publitas-api-resolver.ts
│   │   │   │   ├── yumpu-api-resolver.ts
│   │   │   │   ├── ipaper-api-resolver.ts
│   │   │   │   ├── pdf-resolver.ts
│   │   │   │   ├── fliphtml5-resolver.ts
│   │   │   │   ├── flippingbook-resolver.ts
│   │   │   │   ├── digital-catalogue-resolver.ts
│   │   │   │   ├── tjek-resolver.ts
│   │   │   │   └── downloader.ts     # Image downloading + storage writing
│   │   │   ├── storage/
│   │   │   │   ├── fs-adapter.ts     # Filesystem write adapter
│   │   │   │   └── r2-adapter.ts     # R2 write adapter
│   │   │   └── auto-discover/        # LLM-assisted config generation
│   │   ├── stores/               # Store config JSON files
│   │   │   ├── romania/          # lidl.json, kaufland.json, ...
│   │   │   ├── germany/          # lidl.json, aldi-sued.json, netto.json, ...
│   │   │   ├── france/           # lidl.json, jysk.json, ...
│   │   │   └── ... (28 country folders)
│   │   └── package.json
│   │
│   └── web/                  # Next.js 15 web application
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx                # Root layout
│       │   │   ├── globals.css               # Global styles
│       │   │   ├── page.tsx                  # Home — country selector
│       │   │   └── [country]/
│       │   │       ├── page.tsx              # Country — all catalogs
│       │   │       └── [store]/
│       │   │           ├── page.tsx          # Store — filtered catalogs
│       │   │           └── [catalogId]/
│       │   │               └── page.tsx      # Catalog viewer
│       │   ├── lib/
│       │   │   └── storage.ts        # Lazy storage proxy (CdnReadAdapter)
│       │   └── components/
│       │       ├── Header.tsx
│       │       ├── CountrySelector.tsx
│       │       ├── CatalogGrid.tsx
│       │       ├── CatalogViewer.tsx
│       │       ├── FreshnessIndicator.tsx
│       │       └── CarrotHero.tsx
│       ├── next.config.ts
│       └── package.json
```

## Package Dependency Graph

```
@bestdeal/shared  ←── zero external deps (pure types + utils)
       ↑
       │ imports types + utils
       │
@bestdeal/scraper ←── playwright, @aws-sdk/client-s3, playwright-extra
       ↓
   writes to R2
       ↓
   reads from CDN
       ↓
@bestdeal/web     ←── next, react
       ↑
       │ imports types + utils + CdnReadAdapter
       │
@bestdeal/shared
```

The shared package is the only dependency between scraper and web. It exports:
- **Types**: `CatalogMeta`, `Catalog`, `StoreDefinition`, `StorageAdapter`, etc.
- **Utilities**: `parseDates`, `toISODate`, `buildCatalogId`, `parseCatalogId`, `applyUrlTransforms`
- **Storage adapters** (via sub-path exports): `@bestdeal/shared/storage/cdn`, `@bestdeal/shared/storage/r2`, `@bestdeal/shared/storage/fs`

Storage adapters are NOT exported from the barrel `index.ts` to keep it client-safe (they import `node:fs` or `@aws-sdk` which can't be bundled for browsers).

## The Shared Package

### Types (`src/types/`)

**`catalog.ts`** — Core data model:
- `CatalogStatus`: `"discovered" | "scraping" | "ready" | "expired" | "failed"`
- `CatalogMeta`: The metadata for a catalog (id, store, country, dates, status, page count, scraping info)
- `Catalog`: `CatalogMeta` + `pages: CatalogPage[]`
- `ScrapingInfo`: Internal data used during scraping (resolver name, first page URL, cover URL, last page number)

**`store.ts`** — Store configuration schema:
- `StoreDefinition`: Everything needed to discover catalogs from a store's website
- `LinkPattern`: Regex pattern to extract catalog URLs from a landing page
- `DatePattern`: Regex pattern to extract date ranges from text or slugs
- `UrlTransform`: Chain of URL normalization operations (replace, append, conditional)
- `ApiDiscoveryConfig`: Configuration for API-based catalog discovery (alternative to link-based)

**`storage.ts`** — Storage adapter interfaces:
- `ReadonlyStorageAdapter`: `listCatalogs()`, `getCatalog()`, `getImageUrl()`, `listCountries()`, `listStores()`. Contract: list methods never throw (return `[]`), `getCatalog` returns `null` on missing.
- `StorageAdapter`: extends ReadonlyStorageAdapter + `writeCatalogMeta()`, `writeImage()`, and optional `writeManifest?()`, `deleteCatalog?()`

**`country.ts`** — Country metadata:
- `Country` interface with code, display name, flag emoji, store/catalog counts
- `COUNTRY_META` — static lookup of all 28 supported European countries

### Utilities (`src/utils/`)

**`dates.ts`** — Date handling:
- `parseDates(text, patterns)` — Apply regex patterns with group references ($1, $2, etc.) to extract date ranges
- `toISODate(raw, fallbackYear?, endOfMonth?)` — Convert `DD-MM`, `DD-MM-YYYY`, or `KW{n}-{yy}` formats to ISO 8601
- `isCatalogActive(dateTo)` — Check if a catalog is still current
- `formatDate(isoDate)` — Human-readable date for the UI
- Multi-language month name support: Romanian, French, German (full names and abbreviations)

**`config-id.ts`** — Catalog ID construction:
- `buildCatalogId({country, store, dateFrom, dateTo, catalogType?})` → `"romania-lidl-2026-02-09-2026-02-15"`
- `parseCatalogId(id)` → `{country, store, dateFrom, dateTo, catalogType?}` or `null`
- The regex handles hyphenated store names (e.g., `mega-image`, `aldi-sued`, `la-doi-pasi`)

**`url-transforms.ts`** — URL manipulation:
- `applyUrlTransforms(url, transforms)` — Apply a chain of replace/append/conditional transforms
- `extractCatalogType(url, pattern)` — Extract catalog type from URL via regex
- `buildPageURL(template, pageNum)` — Replace `/page/N` in a URL
- `extractPageNumber(url)` — Extract the page number from a `/page/N` URL

## The Scraper Package

See [scraper-pipeline.md](./scraper-pipeline.md) for the detailed pipeline documentation.

## The Web Package

See [web-app.md](./web-app.md) for the web application documentation.

## Data Flow

```
1. GitHub Actions cron (Mon/Thu 6am UTC)
   │
   ├── Job: scrape-romania
   ├── Job: scrape-germany     (parallel matrix jobs)
   └── Job: scrape-france
        │
        ▼
2. Pipeline Phase 0: Housekeeping
   ├── Recover stale catalogs (stuck in "scraping" → reset to "discovered")
   └── Expire old catalogs (dateTo < today → status = "expired")
        │
        ▼
3. Pipeline Phase 1: Discovery
   ├── Load store configs from packages/scraper/stores/{country}/*.json
   ├── For each store:
   │   ├── Launch Playwright, navigate to landingUrl
   │   ├── Wait waitAfterLoad ms for JS/XHR to settle
   │   ├── Extract all links matching linkPatterns
   │   ├── Parse dates from slug and/or surrounding text
   │   ├── Build catalog ID from {country}-{store}-{dateFrom}-{dateTo}
   │   ├── Skip if catalog already exists in storage
   │   └── Write meta.json with status="discovered" and _scraping info
   └── Report: N catalogs found (X new, Y existing)
        │
        ▼
4. Pipeline Phase 2: Scraping
   ├── For each catalog with status="discovered":
   │   ├── Set status to "scraping"
   │   ├── Look up resolver via resolver registry (auto-detect from URL or manual override)
   │   ├── Resolver returns list of page image URLs (or pre-rendered buffers for PDF)
   │   ├── Download each page image and upload to R2
   │   ├── Set status to "ready", update pageCount
   │   └── On error: set status to "failed"
   └── Generate per-country manifest.json files
        │
        ▼
5. Web App
   ├── CdnReadAdapter fetches {cdnUrl}/{country}/manifest.json
   ├── Lists countries, stores, catalogs from manifests
   └── Serves catalog viewer with CDN image URLs
```

## Storage Architecture

### R2 Bucket Layout

```
bestdeal-catalogs/
├── romania/
│   ├── manifest.json                    # Per-country manifest (list of all ready catalogs)
│   ├── lidl/
│   │   └── romania-lidl-2026-02-09-2026-02-15/
│   │       ├── meta.json                # CatalogMeta
│   │       ├── cover.jpg                # Cover image
│   │       └── pages/
│   │           ├── page-001.jpg
│   │           ├── page-002.jpg
│   │           └── ...
│   ├── kaufland/
│   │   └── romania-kaufland-2026-02-09-2026-02-15-leaflet/
│   │       ├── meta.json
│   │       ├── cover.jpg
│   │       └── pages/
│   │           └── ...
│   └── ...
├── germany/
│   ├── manifest.json
│   └── ...
└── france/
    ├── manifest.json
    └── ...
```

### Storage Adapter Hierarchy

The storage system uses a layered adapter pattern:

**Read-only adapters** (in `@bestdeal/shared`):
- `FsReadAdapter` — Reads from local filesystem. Used for local development.
- `R2ReadAdapter` — Reads from R2 via S3 API. Used by scraper for checking existing catalogs.
- `CdnReadAdapter` — Reads from CDN via HTTP `fetch()`. Used by the web app on Cloudflare Edge runtime. **This is the only adapter that works on Edge** because it doesn't need AWS SDK or Node.js filesystem APIs.

**Read-write adapters** (in `@bestdeal/scraper`):
- `FilesystemAdapter` — Extends `FsReadAdapter`, adds `writeCatalogMeta()`, `writeImage()`, `writeManifest()`, and `deleteCatalog()`.
- `R2StorageAdapter` — Extends `R2ReadAdapter`, adds the same write methods with R2-specific implementation.

Both adapters implement the optional `writeManifest?()` and `deleteCatalog?()` methods from the `StorageAdapter` interface, so the pipeline uses them without unsafe casts.

### Manifest System

The manifest is a JSON index file written per-country after each scraper run:

```json
{
  "updatedAt": "2026-03-15T06:23:45.000Z",
  "catalogs": [
    {
      "id": "romania-lidl-2026-03-10-2026-03-16",
      "store": "lidl",
      "country": "romania",
      "status": "ready",
      "dateFrom": "2026-03-10",
      "dateTo": "2026-03-16",
      "coverImage": "cover.jpg",
      "pageCount": 47
    }
  ]
}
```

The web app's `CdnReadAdapter` fetches all per-country manifests in parallel on each request (with 1-minute TTL cache). Each manifest is validated at runtime using `isCdnManifest()` and `isCatalogMeta()` type guards — malformed JSON is silently dropped rather than crashing the app. This avoids expensive S3 `ListObjects` calls and works on any runtime.

## Deployment Architecture

### Scraper (GitHub Actions)

- **Trigger:** Cron on Monday and Thursday at 6am UTC, plus manual `workflow_dispatch`
- **Strategy:** Matrix of `[romania, germany, france]` running in parallel with `fail-fast: false`
- **Runtime:** Ubuntu latest + Bun + Playwright Chromium
- **Storage:** Writes to R2 via `--storage=r2` flag
- **Timeout:** 30 minutes per country

### Cleanup (GitHub Actions)

- **Trigger:** Daily at midnight UTC
- **Action:** Deletes all catalogs with status `expired` or `failed` from R2
- **Regenerates:** Per-country manifests for affected countries

### Web App (Cloudflare Pages)

- **Domain:** `best-deal-shops.com` (also `<pages-project>.pages.dev`)
- **Build:** `curl -fsSL https://bun.sh/install | bash && ~/.bun/bin/bun install && cd packages/web && ~/.bun/bin/bun run build:cf`
- **Runtime:** Edge (all routes use `export const runtime = "edge"`)
- **ISR:** `revalidate = 300` (5-minute ISR for all pages)
- **Config:** `wrangler.toml` at repo root (compatibility flags: `nodejs_compat`)
- **Auto-deploy:** Push to `master` triggers Cloudflare Pages build

## Key Design Decisions

### Why Scraper Writes, Web Reads

The scraper and web app have fundamentally different runtime requirements:
- Scraper needs Playwright (headless Chromium), AWS SDK, Node.js filesystem — heavy dependencies
- Web app needs to run on Cloudflare Edge — minimal dependencies, no Node.js APIs

By separating them completely and using a CDN as the bridge, neither constrains the other.

### Why CdnReadAdapter Instead of R2ReadAdapter for Web

Cloudflare Edge runtime doesn't support the AWS SDK. The `CdnReadAdapter` uses plain `fetch()` to read from the CDN, which works everywhere. The trade-off is that the web app needs a manifest file to know what catalogs exist (since it can't call `ListObjects`).

### Why Per-Country Manifests

A single global manifest would grow large as more countries are added. Per-country manifests keep each file small and allow the scraper to update only the affected country's manifest after a run. The `CdnReadAdapter` fetches all country manifests in parallel with `Promise.allSettled`.

### Why Store Configs Are JSON Files

Store configurations are declarative JSON because:
- They can be version-controlled and reviewed in PRs
- They follow a strict schema (`StoreDefinition`) that is validated at load time
- Adding a new store requires no code changes — just a new JSON file
- They can be auto-generated by the LLM-powered `--auto-discover` feature

### Why Bun

- Native TypeScript support without a build step (critical for the scraper which runs as a CLI)
- Fast package installation and test runner
- Compatible with Node.js APIs that Playwright and AWS SDK depend on
- Workspace support for the monorepo

### Why Playwright with Stealth Plugin

Many retail websites use bot detection. The `playwright-extra` package with `puppeteer-extra-plugin-stealth` patches common detection vectors (WebGL, navigator properties, etc.) to make the scraper appear as a regular browser.
