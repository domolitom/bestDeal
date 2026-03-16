# Scraper Pipeline

This document provides a complete reference for the bestDeal scraper — the CLI tool that discovers, resolves, downloads, and uploads retail catalogs.

## Table of Contents

- [Overview](#overview)
- [CLI Usage](#cli-usage)
- [Pipeline Phases](#pipeline-phases)
  - [Phase 0: Housekeeping](#phase-0-housekeeping)
  - [Phase 1: Discovery](#phase-1-discovery)
  - [Phase 2: Scraping](#phase-2-scraping)
  - [Manifest Generation](#manifest-generation)
- [Store Config Files](#store-config-files)
  - [Full Schema Reference](#full-schema-reference)
  - [Link Patterns](#link-patterns)
  - [Date Patterns](#date-patterns)
  - [URL Transforms](#url-transforms)
  - [Date Sources](#date-sources)
  - [API Discovery](#api-discovery)
  - [Iframe Extraction](#iframe-extraction)
  - [Catalog Type Patterns](#catalog-type-patterns)
- [Discovery Engine](#discovery-engine)
  - [How Link Extraction Works](#how-link-extraction-works)
  - [How Date Extraction Works](#how-date-extraction-works)
  - [Catalog ID Construction](#catalog-id-construction)
  - [Deduplication](#deduplication)
- [Resolvers](#resolvers)
  - [What Is a Resolver?](#what-is-a-resolver)
  - [Resolver Registry](#resolver-registry)
  - [Auto-Detection Rules](#auto-detection-rules)
  - [Resolver Reference](#resolver-reference)
    - [Leaflets API](#leaflets-api-resolver)
    - [Publitas API](#publitas-api-resolver)
    - [Yumpu API](#yumpu-api-resolver)
    - [iPaper API](#ipaper-api-resolver)
    - [PDF](#pdf-resolver)
    - [FlipHTML5](#fliphtml5-resolver)
    - [FlippingBook](#flippingbook-resolver)
    - [Digital Catalogue](#digital-catalogue-resolver)
    - [Tjek](#tjek-resolver)
    - [Browser (Fallback)](#browser-fallback-resolver)
- [Downloader](#downloader)
- [Storage Backends](#storage-backends)
- [Cleanup Job](#cleanup-job)
- [Browser Configuration](#browser-configuration)
- [Error Handling and Recovery](#error-handling-and-recovery)

---

## Overview

The scraper is a standalone CLI tool built with Bun and Playwright. It runs as a scheduled GitHub Actions job (Monday and Thursday at 6am UTC) and can also be run locally for development and debugging.

The scraper's job is to:
1. Visit store landing pages and discover new catalogs
2. Resolve each catalog's page images using the appropriate platform-specific resolver
3. Download the images and upload them to Cloudflare R2
4. Generate manifest files so the web app knows what catalogs are available

The entire pipeline runs sequentially per store but countries run in parallel via GitHub Actions matrix jobs.

## CLI Usage

The scraper is invoked via the root workspace script:

```bash
# Full pipeline — all countries, all stores, local filesystem storage
bun run scraper

# Limit to a single country
bun run scraper -- --country=romania

# Limit to a single store within a country
bun run scraper -- --store=lidl --country=romania

# Discovery only — find catalogs but don't scrape them
bun run scraper -- --discover-only

# Upload to R2 (production mode)
bun run scraper -- --storage=r2 --country=romania

# Show help
bun run scraper -- --help
```

### All CLI Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--country=NAME` | string | all | Filter by country folder name (e.g., `romania`, `germany`) |
| `--store=NAME` | string | all | Filter by store name (e.g., `lidl`, `kaufland`) |
| `--discover-only` | boolean | false | Only run discovery, skip scraping phase |
| `--storage=TYPE` | string | `fs` | Storage backend: `fs` (local filesystem) or `r2` (Cloudflare R2) |
| `--data-dir=PATH` | string | `../../data/catalogs` | Data directory for filesystem storage |
| `--auto-discover` | boolean | false | Generate a store config using an LLM (requires `--url`, `--store`, `--country`) |
| `--url=URL` | string | — | Landing URL for auto-discover mode |
| `-h, --help` | boolean | false | Show help text |

### Environment Variables for R2 Storage

When using `--storage=r2`, the following environment variables are required:

| Variable | Description | Example |
|----------|-------------|---------|
| `R2_ENDPOINT` | S3-compatible endpoint URL | `https://<account>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Bucket name | `bestdeal-catalogs` |
| `R2_ACCESS_KEY_ID` | R2 API token key ID | `abc123...` |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret | `xyz789...` |
| `R2_PUBLIC_URL` | Public CDN URL for the bucket | `https://cdn.best-deal-shops.com` |

## Pipeline Phases

The pipeline is orchestrated by `runPipeline()` in `packages/scraper/src/pipeline.ts`. It runs four sequential phases:

### Phase 0: Housekeeping

Before any discovery or scraping, the pipeline performs two housekeeping operations:

1. **Recover stale catalogs** — Any catalog stuck in `"scraping"` status (from a previous crashed run) is reset back to `"discovered"` so it gets retried.

2. **Expire old catalogs** — Any catalog with status `"ready"` whose `dateTo` date has passed is marked as `"expired"`. Expired catalogs are later deleted by the cleanup job.

### Phase 1: Discovery

Discovery finds new catalogs by visiting store landing pages with Playwright.

For each store in the selected country:
1. Load the store's JSON config from `packages/scraper/stores/{country}/{store}.json`
2. Launch a Playwright browser and navigate to the `landingUrl`
3. Wait `waitAfterLoad` milliseconds for JavaScript, AJAX calls, and lazy-loaded content to settle
4. Extract all links matching `linkPatterns` (see [Discovery Engine](#discovery-engine) for details)
5. Parse dates from the extracted slugs and/or surrounding text
6. Build a canonical catalog ID from `{country}-{store}-{dateFrom}-{dateTo}[-{type}]`
7. Check if this catalog already exists in storage — skip if it does
8. Detect which resolver should be used (from the URL or manual override)
9. Write `meta.json` to storage with status `"discovered"` and `_scraping` info

Discovery outputs a report of how many catalogs were found (total, new, existing).

### Phase 2: Scraping

For each catalog with status `"discovered"`:

1. Update status to `"scraping"`
2. Look up the resolver from the registry (using the URL and/or `_scraping.resolver` from meta.json)
3. Call `resolver.resolve()` which returns a list of page image URLs (or pre-rendered buffers)
4. If the resolver returns 0 pages, throw an error (pipeline fails for this catalog)
5. Download each page image via HTTP and write it to storage
6. Update status to `"ready"` and set `pageCount` and `scrapedAt`
7. On error: mark the catalog as `"failed"`

### Manifest Generation

After scraping completes, the pipeline generates per-country `manifest.json` files. These are JSON files listing all `"ready"` catalogs for a given country. The web app reads these manifests to know what catalogs are available.

If `--country` was specified, only that country's manifest is regenerated. Otherwise, manifests for all countries with ready catalogs are written.

Manifest generation only happens if the storage backend supports it (`writeManifest()` method exists on the adapter — R2 does, filesystem does not).

## Store Config Files

Store configs are JSON files located at `packages/scraper/stores/{country}/{store}.json`. They are the declarative specification for how to discover catalogs from a store's website. Adding a new store requires only creating a new JSON file — no code changes needed.

The `country` field is automatically injected from the folder name at load time.

### Full Schema Reference

```typescript
interface StoreDefinition {
  // Required fields
  name: string;                    // Store identifier, e.g. "lidl", "kaufland", "mega-image"
  landingUrl: string;              // URL of the page listing current catalogs
  waitAfterLoad: number;           // Milliseconds to wait after page load for JS to settle

  // Link extraction
  linkPatterns: LinkPattern[];     // Regex patterns to find catalog URLs on the landing page
  linkDomain?: string;             // Only consider links to this domain (filter noise)
  linkSelector?: string;           // Custom CSS selector for elements containing URLs
  linkAttribute?: string;          // DOM attribute to read URL from (e.g., "src", "data-href")

  // Date extraction
  dateSource: "slug" | "text" | "slug_then_text";  // Where to look for dates
  datePatterns: DatePattern[];     // Regex patterns to parse date ranges

  // Optional fields
  resolver?: string;               // Force a specific resolver (override auto-detection)
  iframeExtract?: string;          // Regex to find an iframe URL on linked pages
  catalogTypePattern?: CatalogTypePattern;  // Extract catalog type from URL
  apiDiscovery?: ApiDiscoveryConfig;       // API-based discovery (alternative to link patterns)
  displayName?: string;            // Human-readable store name
  logoPath?: string;               // Path to store logo
  delayBetweenPages?: number;      // Delay between page requests (browser resolver only)
  imageExtraction?: ImageExtraction;       // Custom image extraction rules (browser resolver only)
}
```

### Link Patterns

Link patterns are the core mechanism for finding catalog URLs on a store's landing page. Each pattern is a regex applied against every `<a href>` and `<iframe src>` on the page.

```typescript
interface LinkPattern {
  match: string;        // Regex pattern to test against URLs
  slugGroup: number;    // Capture group index for the slug (0 = full URL)
  normalizeUrl: UrlTransform[];  // Chain of URL transformations
}
```

**How it works:**
1. The discovery engine collects all `<a href>` and `<iframe src>` URLs from the landing page
2. If `linkDomain` is set, URLs not containing that domain are filtered out
3. Each URL is tested against each `linkPattern.match` regex
4. On match, the capture group at index `slugGroup` becomes the catalog's slug
5. The `normalizeUrl` transforms are applied to produce the final `firstPageUrl`

**Example — Lidl Romania:**
```json
{
  "linkPatterns": [
    {
      "match": "/cataloage/([^/]+)/view/flyer/page/\\d+",
      "slugGroup": 1,
      "normalizeUrl": [
        { "type": "replace", "match": "/page/\\d+", "replacement": "/page/1" }
      ]
    }
  ]
}
```
This matches URLs like `/cataloage/catalogul-09-02-15-02-2026/view/flyer/page/3`, extracts the slug `catalogul-09-02-15-02-2026`, and normalizes the URL to always point to page 1.

**Custom selectors (`linkSelector` + `linkAttribute`):**

Some stores don't put catalog URLs in standard `<a href>` tags. For example, Netto Germany embeds Tjek catalog thumbnails as `<img>` tags. Use `linkSelector` and `linkAttribute` to extract URLs from arbitrary DOM elements:

```json
{
  "linkSelector": "img[src*='tjek.com']",
  "linkAttribute": "src"
}
```

### Date Patterns

Date patterns extract date ranges from text using regex with capture group references. The patterns are applied either to the catalog slug, the surrounding page text, or both (depending on `dateSource`).

```typescript
interface DatePattern {
  match: string;     // Regex pattern
  dateFrom: string;  // Template using $1, $2, ... group references
  dateTo: string;    // Template using $1, $2, ... group references
}
```

**How templates work:**

The `dateFrom` and `dateTo` strings use `$N` placeholders that are replaced with the corresponding regex capture groups. The resulting strings are then passed through `toISODate()` to convert to ISO 8601 format.

**Example — German date format (DD.MM.YYYY bis DD.MM.YYYY):**
```json
{
  "match": "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s*(?:bis|-|–)\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})",
  "dateFrom": "$1-$2-$3",
  "dateTo": "$4-$5-$6"
}
```
Input: `"14.03.2026 bis 21.03.2026"` → dateFrom: `"14-03-2026"` → ISO: `"2026-03-14"`

**Example — Calendar week (Aldi Süd):**
```json
{
  "match": "kw(\\d+)-(\\d{2})",
  "dateFrom": "KW$1-$2",
  "dateTo": "KW$1-$2"
}
```
Input: `"kw11-26"` → dateFrom: `"KW11-26"` → ISO: `"2026-03-09"` (Monday of week 11)

**Supported date formats in `toISODate()`:**
- `YYYY-MM-DD` — already ISO, returned as-is
- `DD-MM-YYYY` — reordered to ISO
- `DD-MM` — year inferred from `fallbackYear` parameter (typically from the dateTo)
- `KW{n}-{yy}` or `KW{n}-{yyyy}` — Calendar week → Monday (or Saturday if `endOfMonth=true`)
- Month names — Romanian (`ianuarie`, `ian`), French (`janvier`, `février`), German (`Januar`, `Mär`) are all normalized to two-digit month numbers before parsing

### URL Transforms

URL transforms normalize raw URLs extracted from the page into the expected format for the resolver. They are applied as a chain (each transform's output becomes the next's input).

```typescript
// Replace via regex
{ "type": "replace", "match": "/page/\\d+", "replacement": "/page/1" }

// Append a suffix
{ "type": "append", "suffix": "/view/flyer/page/1" }

// Conditional replace
{
  "type": "else",
  "condition": "/view/",
  "ifTrue": { "type": "replace", "match": "...", "replacement": "..." },
  "ifFalse": { "type": "replace", "match": "...", "replacement": "..." }
}
```

### Date Sources

The `dateSource` field controls where dates are extracted from:

| Value | Behavior |
|-------|----------|
| `"slug"` | Parse dates only from the catalog slug (the capture group from `linkPatterns`) |
| `"text"` | Parse dates only from the surrounding page text (card, list item, or parent element) |
| `"slug_then_text"` | Try the slug first. If no dates found, fall back to text. |

**Text extraction** happens automatically: the discovery engine walks up the DOM from the matched link to find the nearest "card" container (by class name heuristics: `card`, `item`, `tile`, `catalog`, `leaflet`, `promo`, etc.) or walks up 5 levels to find reasonable-length text content.

If the surrounding text on the landing page doesn't contain dates, the discovery engine will visit the linked page itself and extract dates from the page's meta description or full HTML content.

### API Discovery

Some stores expose catalog metadata through APIs rather than embedding it in HTML links. The `apiDiscovery` config enables this alternative discovery path.

```typescript
interface ApiDiscoveryConfig {
  selector: string;        // CSS selector for elements containing catalog IDs
  idAttribute: string;     // Data attribute with the catalog identifier
  apiUrl: string;          // API URL template (use {id} as placeholder)
  fieldMap: {
    firstPageUrl: string;  // API response field for the catalog viewer URL
    dateFrom: string;      // API response field for start date
    dateTo: string;        // API response field for end date
    coverImageUrl?: string;
    catalogType?: string;
  };
}
```

**Example — Carrefour Romania:**
```json
{
  "apiDiscovery": {
    "selector": "div[data-catalog]",
    "idAttribute": "data-catalog",
    "apiUrl": "https://corporate.carrefour.ro/api/catalog/{id}",
    "fieldMap": {
      "firstPageUrl": "catalog_link",
      "dateFrom": "start_date",
      "dateTo": "end_date"
    }
  }
}
```

The discovery engine:
1. Finds all elements matching `selector` on the landing page
2. Reads the `idAttribute` from each element
3. Calls the `apiUrl` for each ID (replacing `{id}`)
4. Maps the response fields via `fieldMap`

When `apiDiscovery` is present, `linkPatterns` and `dateSource` are not used for discovery (though `datePatterns` may still be used to parse the API response dates).

### Iframe Extraction

Some stores embed their catalog viewer in an iframe on a separate page. The `iframeExtract` field is a regex pattern — if set, the discovery engine will visit each linked page and look for an `<iframe src>` matching the pattern. The matched iframe URL becomes the `firstPageUrl` passed to the resolver.

**Example — Auchan Romania:**
```json
{
  "iframeExtract": "digital-catalogue\\.com",
  "resolver": "digital-catalogue"
}
```

The discovery engine will:
1. Find catalog links on the landing page via `linkPatterns`
2. Visit each linked page
3. Wait 8 seconds for the iframe to load
4. Extract the iframe URL matching `digital-catalogue.com`
5. Use that iframe URL as the `firstPageUrl` for the digital-catalogue resolver

### Catalog Type Patterns

Some stores have multiple types of catalogs (e.g., hypermarket, supermarket, weekly, monthly). The `catalogTypePattern` extracts a type label from the catalog URL.

```typescript
interface CatalogTypePattern {
  match: string;          // Regex with a capture group
  caseInsensitive?: boolean;
  transform?: "lowercase" | "uppercase";
}
```

**Example — Aldi Süd:**
```json
{
  "catalogTypePattern": {
    "match": "kw\\d+-\\d+-(.*)",
    "transform": "lowercase"
  }
}
```

This extracts a type from URLs like `kw11-26-angebote` → `"angebote"`.

The catalog type is appended to the catalog ID: `germany-aldi-sued-2026-03-09-2026-03-14-angebote`.

## Discovery Engine

The discovery engine (`packages/scraper/src/discovery/discovery-engine.ts`) is the core of how catalogs are found on store websites.

### How Link Extraction Works

The discovery engine uses Playwright's `page.evaluate()` to run JavaScript inside the browser context. This is essential because many store pages use heavy JavaScript to render their catalog lists.

The extraction process:

1. **Collect candidates** — If `linkSelector` + `linkAttribute` are set, use those. Otherwise, collect all `<a href>` and `<iframe src>` elements.

2. **Filter by domain** — If `linkDomain` is set, only keep URLs containing that domain string. This dramatically reduces noise (e.g., only keeping `leaflets.schwarz` links on Lidl pages).

3. **Match patterns** — For each candidate URL, test each `linkPattern.match` regex. On first match, extract the slug from the specified capture group.

4. **Deduplicate by slug** — If a slug has already been seen, skip it.

5. **Extract surrounding text** — For date extraction, the engine tries to find the nearest "card" container by walking up the DOM looking for common CSS class patterns (`card`, `item`, `tile`, `catalog`, `leaflet`, `promo`, `brosur`). If no card is found, it walks up 5 levels and takes the text content of the widest reasonable parent (< 2000 chars).

6. **Visit linked pages** (if needed) — When `dateSource` includes `"text"` and dates aren't found in the surrounding text, or when `iframeExtract` is set, the engine navigates to each linked page to extract additional information.

### How Date Extraction Works

Dates are extracted in a two-pass approach:

**Pass 1: From slug** (if `dateSource` is `"slug"` or `"slug_then_text"`):
- Apply each `datePattern` regex to the slug string
- Use `$N` group references to build raw date strings
- Example: slug `"catalogul-09-02-15-02-2026"` with pattern `(\\d{2}-\\d{2})-(\\d{2}-\\d{2}-\\d{4})$` → dateFrom=`"09-02"`, dateTo=`"15-02-2026"`

**Pass 2: From text** (if `dateSource` is `"text"` or if slug parsing failed for `"slug_then_text"`):
- Apply each `datePattern` regex to the surrounding text content
- The text comes from the card container found during link extraction, or from the linked page's meta description / HTML

**ISO conversion**: Raw dates like `"09-02"` or `"15-02-2026"` are then converted to ISO 8601 by `toISODate()`:
- `"09-02"` with fallback year 2026 → `"2026-02-09"`
- `"15-02-2026"` → `"2026-02-15"`
- `"KW11-26"` → `"2026-03-09"` (Monday of calendar week 11)

If no dates can be extracted for a catalog, it is skipped with a warning.

### Catalog ID Construction

Catalog IDs are deterministic and built from:
```
{country}-{store}-{isoDateFrom}-{isoDateTo}[-{catalogType}]
```

Examples:
- `romania-lidl-2026-02-09-2026-02-15`
- `germany-kaufland-2026-03-10-2026-03-16-leaflet`
- `germany-aldi-sued-2026-03-09-2026-03-14-angebote`
- `romania-mega-image-2026-03-12-2026-03-18`

The `parseCatalogId()` function can reverse this, handling hyphenated store names like `mega-image` and `aldi-sued` via a non-greedy regex for the store group.

### Deduplication

The discoverer maintains two sets for deduplication:
1. **`existingIds`** — All catalog IDs already in storage (from `storage.listCatalogs()`)
2. **`seenIds`** — Catalog IDs discovered in the current run (to avoid duplicates when a catalog appears multiple times on a page)

If a catalog ID is in either set, it is logged as "existing" and skipped.

## Resolvers

### What Is a Resolver?

A **resolver** is a module that takes a catalog's `firstPageUrl` and returns a list of page image URLs (or pre-rendered image buffers). Each resolver understands one specific catalog hosting platform.

The key insight is that retail catalogs are hosted on a variety of third-party platforms (Publitas, iPaper, Yumpu, FlipHTML5, etc.), each with different ways to access page images. The resolver abstraction lets us support all of them with a consistent interface while the platform-specific logic is encapsulated in each resolver.

```typescript
interface CatalogResolver {
  name: string;                    // e.g., "leaflets", "publitas", "ipaper"
  needsLastPage: boolean;          // Whether discovery needs to probe for the last page
  resolve(input: ResolveInput): Promise<ResolveResult>;
}

interface ResolveInput {
  catalogId: string;
  firstPageUrl: string;
  coverImageUrl?: string;
  lastPage?: number;               // Only set for browser resolver
}

interface ResolveResult {
  catalogId: string;
  coverImageUrl: string;
  pages: ResolvedPage[];
}

interface ResolvedPage {
  number: number;
  imageUrl: string;
  imageData?: Buffer;              // Pre-rendered data (used by PDF resolver)
}
```

Most resolvers (`needsLastPage: false`) determine the page count themselves from API responses or HTML parsing. Only the browser resolver (`needsLastPage: true`) requires the discovery phase to probe for the last valid page using binary search.

### Resolver Registry

The resolver registry (`packages/scraper/src/scraping/resolver-registry.ts`) is a central map from resolver names to resolver instances. Each resolver file registers itself as a side-effect import:

```typescript
// In pipeline.ts:
import "./scraping/leaflets-api-resolver.ts";  // registers "leaflets"
import "./scraping/publitas-api-resolver.ts";  // registers "publitas"
// ... etc.
```

The registry provides two functions:
- `detectResolverName(url, overrideName?)` — Pure function that determines which resolver to use. If `overrideName` is set (from `StoreDefinition.resolver`), it's used directly. Otherwise, the URL is tested against auto-detection rules.
- `getResolver(url, overrideName?)` — Returns the actual resolver instance. Throws if the resolver isn't registered.

### Auto-Detection Rules

When no `resolver` override is specified in the store config, the registry uses URL-pattern-based auto-detection:

| URL Pattern | Resolver | Example Store |
|-------------|----------|---------------|
| `leaflets.schwarz` or `leaflets.kaufland` | `leaflets` | Lidl, Kaufland |
| `publitas.com` or `cataloage.carrefour.ro` | `publitas` | Carrefour, Aldi Süd, Metro, Hornbach |
| `yumpu.com` | `yumpu` | Selgros |
| `ipapercms.dk`, `ipaper.io`, `/CampaignPaper/`, `/Catalog/` | `ipaper` | JYSK, Fressnapf |
| `fliphtml5.com` | `fliphtml5` | Animax |
| `.pdf` extension | `pdf` | Müller |
| `files.rewe.co.at` | `flippingbook` | Penny Romania |
| `digital-catalogue.com` | `digital-catalogue` | Auchan |
| *(no match)* | `browser` | Fallback — screenshot each page |

**When to use `resolver` override:** Some stores have URLs that don't match the auto-detection rules. For example, Lidl Romania's catalog URLs contain `leaflets.schwarz` in the full URL but discovery extracts a normalized URL that doesn't. Setting `"resolver": "leaflets"` in the store config forces the correct resolver.

### Resolver Reference

#### Leaflets API Resolver

**Name:** `leaflets`
**Platform:** Schwarz Group (Lidl, Kaufland)
**How it works:**
1. Extract the flyer slug from the URL (e.g., `du-26-02-au-04-03-les-promos-de-la-semaine`)
2. Derive the API host: `leaflets.schwarz` → `endpoints.leaflets.schwarz`
3. Call `https://endpoints.leaflets.{host}/v4/flyer?flyer_identifier={slug}`
4. The API returns a JSON with a `flyer.pages[]` array, each containing an `image` URL
5. Return all page image URLs

**Requires browser:** No (pure HTTP)
**Typical page count:** 30-60 pages
**Used by:** Lidl (all countries), Kaufland (all countries)

#### Publitas API Resolver

**Name:** `publitas`
**Platform:** Publitas (Dutch catalog hosting platform)
**How it works:**
1. Extract the base URL from the firstPageUrl (everything before `/page/N`)
2. Fetch `{baseUrl}/spreads.json`
3. The JSON contains an array of spreads, each with multiple pages
4. Each page has image URLs at different sizes: `at1200`, `at1000`, etc.
5. Prefer `at1200` (good balance of quality vs. size, ~300KB per page)
6. Construct full URLs by prepending the origin

**Requires browser:** No (pure HTTP)
**Used by:** Carrefour Romania, Aldi Süd, Metro (DE & RO), Hornbach, REWE, MediaMarkt

#### Yumpu API Resolver

**Name:** `yumpu`
**Platform:** Yumpu (document hosting)
**How it works:**
1. Extract the document ID from the URL (e.g., `67944690`)
2. Extract the language segment (e.g., `ro`)
3. Call `https://www.yumpu.com/{lang}/document/json/{docId}`
4. API returns page numbers and a URL title slug
5. Construct CDN image URLs: `https://img.yumpu.com/{docId}/{pageNr}/1132x1600/{slug}.jpg`

**Requires browser:** No (pure HTTP)
**Used by:** Selgros Romania

#### iPaper API Resolver

**Name:** `ipaper`
**Platform:** iPaper (Danish catalog platform)
**How it works:**
1. Load the firstPageUrl in Playwright
2. Wait for the page to render (iPaper uses heavy JavaScript)
3. Extract `window.staticSettings` from the page
4. Settings contain a `pages[]` array (page numbers) and `aws` object (S3 URL + signed policy)
5. Construct image URLs: `{aws.url}Pages/{pageNr}/Zoom.jpg?{aws.policy}`

**Requires browser:** Yes (Playwright, for extracting signed AWS credentials from the rendered page)
**Note:** The AWS credentials are short-lived signed URLs embedded in the page HTML
**Used by:** JYSK (all countries), Fressnapf

#### PDF Resolver

**Name:** `pdf`
**Platform:** Direct PDF files
**How it works:**
1. Download the PDF file server-side via `fetch()`
2. Base64-encode the PDF data
3. Open a Playwright browser and inject pdf.js from CDN
4. Render each page at 2x scale onto a `<canvas>` element
5. Extract each canvas as a JPEG data URL
6. Return `imageData` buffers (not URLs) — the downloader writes these directly without downloading

**Requires browser:** Yes (Playwright + pdf.js for rendering)
**Note:** This is the only resolver that returns `imageData` buffers instead of URLs. The PDF is downloaded server-side to avoid CORS issues.
**Used by:** Müller Germany

#### FlipHTML5 Resolver

**Name:** `fliphtml5`
**Platform:** FlipHTML5 (cloud flipbook platform)
**How it works:**
1. Load the book URL in Playwright with `waitUntil: "networkidle"`
2. FlipHTML5 uses a WASM-based decoder (`deString.js`) to decode page data from `config.js`
3. Wait for `window.fliphtml5_pages` to be populated (up to 15 seconds)
4. Extract the pages array — each page has an `n` field (image path, e.g., `files/large/{hash}.webp`)
5. Construct full URLs: `{baseUrl}/{page.n}`

**Requires browser:** Yes (Playwright, for WASM decoder execution)
**Used by:** Animax Romania

#### FlippingBook Resolver

**Name:** `flippingbook`
**Platform:** FlippingBook (professional flipbook)
**How it works:**
1. Fetch the base URL via HTTP (no browser needed)
2. Parse the HTML to find page links: `href="./2/"`, `href="./3/"`, etc.
3. The highest page number is the total page count
4. Construct image URLs using the predictable pattern: `{baseUrl}/files/assets/common/page-html5-substrates/page{NNNN}_{quality}.jpg`
5. Quality level 3 (highest) is used

**Requires browser:** No (pure HTTP)
**Used by:** Penny Romania

#### Digital Catalogue Resolver

**Name:** `digital-catalogue`
**Platform:** digital-catalogue.com
**How it works:**
1. Fetch the firstPageUrl via HTTP with a browser User-Agent header
2. Extract `pagesNumber` from the HTML (embedded as JSON in the page)
3. Extract the storage path from the HTML (e.g., `storage/s1/catalogs/account/pub-id/common/data`)
4. Construct image URLs: `{origin}/{storagePath}/{NNNN}.webp`

**Requires browser:** No (pure HTTP)
**Used by:** Auchan Romania

#### Tjek Resolver

**Name:** `tjek`
**Platform:** Tjek (Danish retail data platform)
**How it works:**
1. Load the store's page in Playwright (e.g., `netto.de/prospekte/`)
2. Wait 12 seconds for content to load
3. Click the first catalog thumbnail (finding `img[src*='tjek.com']` and clicking its parent)
4. Wait 8 seconds for the viewer to open
5. Extract all Tjek image URLs from the full HTML using regex
6. Filter for URLs containing `/p-` and `w=700` (page images, not thumbnails)
7. Group by catalog ID and pick the catalog with the most pages
8. Sort pages by number and deduplicate

**Requires browser:** Yes (Playwright, for clicking into the viewer)
**Note:** Tjek URLs often contain URL-encoded slashes (`%2F`) which need special handling
**Used by:** Netto Germany

#### Browser (Fallback) Resolver

**Name:** `browser`
**Platform:** Any website with a page-based viewer
**How it works:**
1. This is the slowest resolver — it screenshots each page individually
2. During discovery, the last page number must be determined via binary search (probing page URLs)
3. For each page number from 1 to lastPage:
   - Navigate to the page URL
   - Wait for images to load
   - Find the largest image on the page (filtering out navigation, thumbnails, etc.)
   - Extract the image's `src` URL
4. Browser context is refreshed every 15 pages to avoid rate limiting
5. 3-second delay between pages by default

**Requires browser:** Yes (Playwright, for each individual page)
**Performance:** Very slow (~5 seconds per page). A 60-page catalog takes ~5 minutes.
**When to use:** Only as a last resort when no platform-specific API or pattern is available. Always prefer writing a dedicated resolver.
**Used by:** Lidl Germany (when leaflets API doesn't work)

## Downloader

The downloader (`packages/scraper/src/scraping/downloader.ts`) takes a `ResolveResult` and writes all images to storage.

For each catalog:
1. **Cover image** — Downloaded from the first page's `imageData` (if available) or `coverImageUrl`
2. **Page images** — Downloaded sequentially. Each page is either:
   - Fetched via HTTP from `page.imageUrl` (most resolvers)
   - Written directly from `page.imageData` buffer (PDF resolver)

Images are saved as:
- `cover.jpg` — Cover image
- `pages/page-001.jpg`, `pages/page-002.jpg`, ... — Numbered page images

HTTP downloads include a `Referer` header (set to the image URL's origin) and a Chrome User-Agent to avoid hotlink protection.

## Storage Backends

### Filesystem (`--storage=fs`, default)

Writes to `{data-dir}/{country}/{store}/{catalogId}/`. Default data directory is `../../data/catalogs` relative to the scraper source.

Used for local development and testing. Does not support manifest generation.

### R2 (`--storage=r2`)

Writes to the `bestdeal-catalogs` R2 bucket via S3-compatible API. Includes:
- `meta.json` with `Content-Type: application/json`
- Page images with `Content-Type: image/jpeg` and `Cache-Control: public, max-age=604800, immutable` (7-day cache, immutable because page images never change)
- Manifest files with `Cache-Control: public, max-age=60` (1-minute cache, updates frequently)

Supports `writeManifest()` for generating per-country manifest files and `deleteCatalog()` for cleanup.

## Cleanup Job

The cleanup job (`packages/scraper/src/cleanup.ts`) runs daily at midnight UTC via a separate GitHub Actions workflow. It:

1. Lists all catalogs with status `"expired"` or `"failed"`
2. Deletes all R2 objects for each catalog (meta.json, cover.jpg, all page images)
3. Regenerates per-country manifests for affected countries

This keeps the R2 bucket clean and ensures the CDN doesn't serve stale data.

## Browser Configuration

The scraper uses Playwright with the Stealth plugin (`packages/scraper/src/browser.ts`):

```typescript
import pw from "playwright";
import { PlaywrightExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

const chromium = new PlaywrightExtra(pw.chromium);
chromium.use(StealthPlugin());
```

The Stealth plugin patches various browser fingerprinting vectors to avoid bot detection:
- WebGL renderer info
- Navigator properties (plugins, languages, platform)
- Chrome-specific APIs
- Permission API responses

Browser is launched with `headless: true` and a viewport of 800x1200 (portrait orientation, suitable for catalog pages).

## Error Handling and Recovery

### Per-Catalog Error Isolation

Errors during scraping are caught per-catalog. A failing catalog:
1. Is marked as `"failed"` in storage
2. Is reported in the pipeline's `failed` array
3. Does **not** stop the pipeline — other catalogs continue processing

### Stale Recovery

If the scraper process crashes mid-scrape (e.g., GitHub Actions timeout), catalogs stuck in `"scraping"` status are automatically recovered on the next run. Phase 0 resets them to `"discovered"` so they get retried.

### 0-Page Guard

If a resolver returns 0 pages, the pipeline throws an error for that catalog. This prevents empty catalogs from being marked as `"ready"` and appearing on the website with no content.

### Consecutive Failure Abort (Browser Resolver)

The browser resolver aborts after 5 consecutive page extraction failures. This prevents wasting time when a catalog viewer is broken or the pages have a different structure than expected.
