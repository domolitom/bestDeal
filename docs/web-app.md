# Web Application

This document describes the bestDeal web application — a Next.js 15 app that serves retail catalogs to users.

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Route Structure](#route-structure)
- [How Data Is Loaded](#how-data-is-loaded)
- [Components](#components)
- [Edge Runtime](#edge-runtime)
- [Deployment](#deployment)
- [Local Development](#local-development)

---

## Overview

The web app is a read-only catalog browser. It reads catalog metadata and images from the CDN (Cloudflare R2 public bucket) and renders them in a responsive interface. It never writes data — that's the scraper's job.

The app is deployed on Cloudflare Pages with Edge runtime, meaning all server-side rendering happens at Cloudflare's edge network closest to the user.

**Live URL:** `https://best-deal-shops.com` (also `https://<pages-project>.pages.dev`)

## Technology Stack

- **Framework:** Next.js 15 with App Router
- **React:** React 19
- **Runtime:** Cloudflare Pages Edge (all routes use `export const runtime = "edge"`)
- **Styling:** Vanilla CSS (`globals.css`)
- **Data:** CDN read adapter (`CdnReadAdapter`) from `@bestdeal/shared`
- **ISR:** 5-minute revalidation (`export const revalidate = 300`)

## Route Structure

The app uses Next.js dynamic routes to create a three-level hierarchy:

```
/                           → Home page (country selector)
/[country]                  → Country page (all catalogs for a country)
/[country]/[store]          → Store page (catalogs filtered by store)
/[country]/[store]/[catalogId]  → Catalog viewer (full page viewer)
```

### Home Page (`/`)

- Fetches all countries that have catalogs via `storage.listCountries()`
- Displays a country selector with flags, names, and catalog counts
- Shows the `CarrotHero` mascot component

### Country Page (`/[country]`)

- Fetches all stores and catalogs for the country
- Shows store "pills" for filtering (clickable links to `/{country}/{store}`)
- Renders a `CatalogGrid` with cover images, store names, date ranges, and page counts
- Returns 404 if no stores exist for the country

### Store Page (`/[country]/[store]`)

- Same as country page but filtered to a single store
- Shows all stores in the pills bar with the active store highlighted
- Returns 404 if the store doesn't exist in that country

### Catalog Viewer (`/[country]/[store]/[catalogId]`)

- Fetches full catalog data including all page URLs
- Shows store name, date range, freshness indicator, page count
- Renders `CatalogViewer` component with all page images
- Returns 404 if the catalog doesn't exist

## How Data Is Loaded

### Storage Proxy

The web app creates a lazy-initialized storage proxy in `packages/web/src/lib/storage.ts`:

```typescript
import { CdnReadAdapter } from "@bestdeal/shared/storage/cdn";

function createStorage(): ReadonlyStorageAdapter {
  const cdnUrl = process.env.NEXT_PUBLIC_CDN_URL || process.env.R2_PUBLIC_URL;
  if (cdnUrl) return new CdnReadAdapter(cdnUrl);
  throw new Error("NEXT_PUBLIC_CDN_URL not set");
}
```

The proxy ensures `createStorage()` is only called when a method is actually invoked (avoiding errors during build time when env vars might not be set).

### CdnReadAdapter Data Flow

1. **List countries/catalogs:** The adapter fetches `{cdnUrl}/{country}/manifest.json` for every country in `COUNTRY_META` (28 countries) using `Promise.allSettled`. Each response is validated at runtime using `isCdnManifest()` and `isCatalogMeta()` type guards — malformed or invalid JSON is silently dropped. Results are cached for 1 minute.

2. **Get single catalog:** The adapter fetches `{cdnUrl}/{country}/{store}/{catalogId}/meta.json`, validates it with `isCatalogMeta()`, and constructs the pages array from the `pageCount` field. Returns `null` if validation fails.

3. **Image URLs:** Constructed as `{cdnUrl}/{country}/{store}/{catalogId}/pages/page-001.jpg`. These are direct CDN URLs — no proxy or API route needed.

### Caching Strategy

- **ISR (server-side):** All pages use `export const revalidate = 300` — Next.js regenerates the page at most every 5 minutes.
- **Manifest cache (adapter-level):** `CdnReadAdapter` caches the merged manifest for 60 seconds to avoid redundant fetches within a single request cycle.
- **Image cache (CDN-level):** Page images are uploaded with `Cache-Control: public, max-age=604800, immutable` (7-day cache). They never change once uploaded.
- **Manifest cache (CDN-level):** Manifest files have `Cache-Control: public, max-age=60` (1-minute cache) to quickly reflect new catalogs.

## Components

### Header

Navigation breadcrumbs. Shows the site title and a chain of crumbs (country → store → date range). Uses the `COUNTRY_META` lookup for display names.

### CountrySelector

Grid of country cards on the home page. Each card shows the country flag, name, and counts of stores/catalogs.

### CatalogGrid

Grid of catalog cards used on country and store pages. Each card shows the cover image, store name, date range, catalog type (if any), and page count.

### CatalogViewer

Full-page catalog viewer. Renders all page images vertically. Images are lazy-loaded with CDN URLs.

### FreshnessIndicator / StatusBadge

Shows how many days remain until a catalog expires, or whether it's already expired. Color-coded: green for active, yellow for expiring soon, red for expired.

### CarrotHero

Decorative mascot component for the home page.

## Edge Runtime

Every route exports `export const runtime = "edge"` which tells Next.js to run the server-side rendering on Cloudflare's edge network. This is critical because:

1. **Performance:** Pages are rendered at the CDN edge closest to the user, reducing latency.
2. **Compatibility:** Edge runtime is the only option on Cloudflare Pages — Node.js runtime is not available.
3. **Constraints:** No Node.js APIs (filesystem, child_process, etc.). Only Web APIs (`fetch`, `crypto`, etc.) are available. This is why the web app uses `CdnReadAdapter` (HTTP-only) instead of `R2ReadAdapter` (AWS SDK).

The `wrangler.toml` at the repo root enables `nodejs_compat` compatibility flag, which provides polyfills for some Node.js APIs that Next.js internals need.

## Deployment

### Build Process

Cloudflare Pages runs this build command on every push to `master`:

```bash
curl -fsSL https://bun.sh/install | bash && \
  ~/.bun/bin/bun install && \
  cd packages/web && \
  ~/.bun/bin/bun run build:cf
```

The `build:cf` script builds the Next.js app with the `@cloudflare/next-on-pages` adapter, which compiles the app for Cloudflare Pages.

### Environment Variables

Set in the Cloudflare Pages dashboard (or via `wrangler pages secret put`):

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_CDN_URL` | `https://cdn.best-deal-shops.com` |
| `SKIP_DEPENDENCY_INSTALL` | `true` (Bun handles this) |

### Wrangler Config

`wrangler.toml` at the repo root:

```toml
name = "bestdeal"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "packages/web/.vercel/output/static"
```

## Local Development

```bash
# Set up environment
cp .env.example .env.local  # or create manually with NEXT_PUBLIC_CDN_URL

# Start dev server
source .env.local && bun run dev
```

The dev server uses the same `CdnReadAdapter` pointing to the production CDN. This means local development shows real catalog data without needing a local scraper run.

Alternatively, run the scraper locally with `--storage=fs` first, then the web app could be configured to use `FsReadAdapter` — but this requires modifying `storage.ts` and is not the standard workflow.
