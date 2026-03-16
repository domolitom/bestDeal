# Resolvers — Complete Guide

This document provides an in-depth explanation of what resolvers are, how they work, and how to write a new one.

## Table of Contents

- [What Is a Resolver?](#what-is-a-resolver)
- [Why Do We Need Resolvers?](#why-do-we-need-resolvers)
- [The Resolver Interface](#the-resolver-interface)
- [The Resolver Registry](#the-resolver-registry)
- [How a Resolver Gets Selected](#how-a-resolver-gets-selected)
- [Resolver Lifecycle in the Pipeline](#resolver-lifecycle-in-the-pipeline)
- [All Resolvers in Detail](#all-resolvers-in-detail)
  - [1. Leaflets API (Lidl, Kaufland)](#1-leaflets-api-lidl-kaufland)
  - [2. Publitas API (Carrefour, Aldi Süd, Metro, Hornbach)](#2-publitas-api-carrefour-aldi-süd-metro-hornbach)
  - [3. Yumpu API (Selgros)](#3-yumpu-api-selgros)
  - [4. iPaper API (JYSK, Fressnapf)](#4-ipaper-api-jysk-fressnapf)
  - [5. PDF (Müller)](#5-pdf-müller)
  - [6. FlipHTML5 (Animax)](#6-fliphtml5-animax)
  - [7. FlippingBook (Penny Romania)](#7-flippingbook-penny-romania)
  - [8. Digital Catalogue (Auchan)](#8-digital-catalogue-auchan)
  - [9. Tjek (Netto)](#9-tjek-netto)
  - [10. Browser Fallback](#10-browser-fallback)
- [How to Write a New Resolver](#how-to-write-a-new-resolver)
  - [Step 1: Research the Platform](#step-1-research-the-platform)
  - [Step 2: Create the Resolver File](#step-2-create-the-resolver-file)
  - [Step 3: Register in Pipeline](#step-3-register-in-pipeline)
  - [Step 4: Add Auto-Detection Rule (Optional)](#step-4-add-auto-detection-rule-optional)
  - [Template: HTTP-Only Resolver](#template-http-only-resolver)
  - [Template: Browser-Based Resolver](#template-browser-based-resolver)
- [Resolver Decision Matrix](#resolver-decision-matrix)

---

## What Is a Resolver?

A resolver is a module that knows how to extract all page image URLs from a specific catalog hosting platform. It takes a single catalog URL (the `firstPageUrl`) and returns a complete list of page image URLs.

Think of it as an adapter between our generic scraping pipeline and the specific API/structure of each third-party catalog platform.

## Why Do We Need Resolvers?

Retail catalogs are hosted on many different platforms, each with their own way of storing and serving page images:

- **Publitas** stores pages in a `spreads.json` file
- **iPaper** embeds page data in `window.staticSettings` with signed AWS URLs
- **FlipHTML5** uses a WASM decoder to populate `window.fliphtml5_pages`
- **Yumpu** has a JSON API at `/document/json/{id}`
- **FlippingBook** uses predictable URL patterns for page images

Without resolvers, we'd need to write custom scraping logic for every single store. Instead, we write one resolver per platform and reuse it across all stores on that platform. For example:
- The `publitas` resolver serves Carrefour (RO), Aldi Süd (DE), Metro (DE & RO), Hornbach (DE), REWE (DE), and MediaMarkt (DE)
- The `ipaper` resolver serves JYSK in 20+ countries and Fressnapf (DE)
- The `leaflets` resolver serves Lidl and Kaufland in 24+ countries

## The Resolver Interface

Every resolver implements this interface:

```typescript
interface CatalogResolver {
  name: string;           // Unique identifier, e.g., "leaflets", "publitas"
  needsLastPage: boolean; // Does discovery need to determine the last page number?
  resolve(input: ResolveInput): Promise<ResolveResult>;
}
```

**Input:**
```typescript
interface ResolveInput {
  catalogId: string;       // e.g., "romania-lidl-2026-02-09-2026-02-15"
  firstPageUrl: string;    // The URL to start resolving from
  coverImageUrl?: string;  // URL for the cover image (optional)
  lastPage?: number;       // Total page count (only for browser resolver)
  imageExtraction?: ImageExtraction;    // Custom extraction rules (browser only)
  delayBetweenPages?: number;          // Delay in ms (browser only)
}
```

**Output:**
```typescript
interface ResolveResult {
  catalogId: string;
  coverImageUrl: string;   // URL of the cover image
  pages: ResolvedPage[];   // All page images
}

interface ResolvedPage {
  number: number;          // Page number (1-based)
  imageUrl: string;        // Direct URL to the page image
  imageData?: Buffer;      // Pre-rendered image data (PDF resolver only)
}
```

**The `needsLastPage` flag:**
- `false` (most resolvers): The resolver determines the page count itself from API responses or HTML parsing. Discovery skips the slow page-probing step.
- `true` (browser resolver only): Discovery must determine the last valid page via binary search, navigating to progressively higher page numbers until one fails.

## The Resolver Registry

The registry (`packages/scraper/src/scraping/resolver-registry.ts`) is a `Map<string, CatalogResolver>`. Each resolver file registers itself via a side-effect import:

```typescript
// In each resolver file:
const myResolver: CatalogResolver = {
  name: "my-resolver",
  needsLastPage: false,
  resolve: resolveViaMyPlatform,
};
registerResolver(myResolver);

// In pipeline.ts — side-effect imports that trigger registration:
import "./scraping/leaflets-api-resolver.ts";
import "./scraping/publitas-api-resolver.ts";
// ... etc.
```

## How a Resolver Gets Selected

Resolver selection happens in two stages:

### During Discovery (lightweight detection)

`detectResolverName(url, overrideName?)` is called:
1. If `overrideName` is set (from `StoreDefinition.resolver`), return it directly
2. Otherwise, test the URL against auto-detection rules:

| URL Contains | Resolver |
|-------------|----------|
| `leaflets.schwarz` or `leaflets.kaufland` | `leaflets` |
| `publitas.com` or `cataloage.carrefour.ro` | `publitas` |
| `yumpu.com` | `yumpu` |
| `ipapercms.dk`, `ipaper.io`, `/CampaignPaper/`, `/Catalog/` | `ipaper` |
| `fliphtml5.com` | `fliphtml5` |
| `.pdf` extension | `pdf` |
| `files.rewe.co.at` | `flippingbook` |
| `digital-catalogue.com` | `digital-catalogue` |

3. If nothing matches, default to `"browser"`

The resolver name is stored in `meta.json._scraping.resolver` at discovery time.

### During Scraping (full resolution)

`getResolver(url, overrideName?)` is called, which uses the same detection logic but returns the actual resolver instance from the registry. If the resolver isn't registered (import missing), it throws an error.

## Resolver Lifecycle in the Pipeline

```
Discovery Phase:
  1. Find catalog URL from landing page
  2. detectResolverName(url, config.resolver) → "publitas"
  3. Store resolver name in meta.json._scraping.resolver
  4. Skip page probing (needsLastPage = false)

Scraping Phase:
  1. Read meta.json._scraping
  2. getResolver(firstPageUrl, "publitas") → publitasResolver instance
  3. resolver.resolve({ firstPageUrl, catalogId, ... })
  4. Resolver returns list of page image URLs
  5. Downloader fetches each URL and writes to storage
```

## All Resolvers in Detail

### 1. Leaflets API (Lidl, Kaufland)

**File:** `leaflets-api-resolver.ts`
**Name:** `leaflets`
**Requires browser:** No
**How it works:**

The Schwarz Group (Lidl, Kaufland) operates a leaflets API:

```
https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier={slug}
```

The resolver:
1. Extracts the flyer slug from the URL (e.g., `catalogul-09-02-15-02-2026`)
2. Derives the API host from the URL domain (e.g., `leaflets.schwarz` → `endpoints.leaflets.schwarz`)
3. Fetches the API and parses `flyer.pages[]`
4. Returns direct image URLs from the `image` field of each page

**Key detail:** The API host varies by brand:
- Lidl: `endpoints.leaflets.schwarz`
- Kaufland: `endpoints.leaflets.kaufland.com` (note: `.com` suffix)

**Why manual resolver override?** Lidl store configs set `"resolver": "leaflets"` because the normalized firstPageUrl may not contain `leaflets.schwarz` (the auto-detection pattern). The original landing page URL does, but after `normalizeUrl` transforms, the domain info may be stripped.

### 2. Publitas API (Carrefour, Aldi Süd, Metro, Hornbach)

**File:** `publitas-api-resolver.ts`
**Name:** `publitas`
**Requires browser:** No
**How it works:**

Publitas catalogs expose a `spreads.json` endpoint:

```
https://view.publitas.com/{publisher}/{slug}/spreads.json
```

or on custom domains:

```
https://cataloage.carrefour.ro/{slug}/spreads.json
https://prospekt.aldi-sued.de/{slug}/spreads.json
```

The resolver:
1. Extracts the base URL (everything before `/page/N`)
2. Appends `/spreads.json`
3. Parses the JSON which contains spreads → pages → images at different sizes
4. Selects the `at1200` size (1200px wide, good quality/size balance)
5. Constructs full URLs by prepending the origin

**Image sizes available:** `at600`, `at1000`, `at1200`, `at1600`, `at2000`. We use `at1200` as default, falling back to `at1000`.

### 3. Yumpu API (Selgros)

**File:** `yumpu-api-resolver.ts`
**Name:** `yumpu`
**Requires browser:** No
**How it works:**

Yumpu has a public JSON API:

```
https://www.yumpu.com/{lang}/document/json/{docId}
```

The resolver:
1. Extracts the document ID from the URL (e.g., `67944690`)
2. Extracts the language code (e.g., `ro`)
3. Fetches the JSON API
4. Constructs CDN URLs: `https://img.yumpu.com/{docId}/{pageNr}/1132x1600/{slug}.jpg`

**Image size:** 1132x1600 pixels (fixed size, good quality)

### 4. iPaper API (JYSK, Fressnapf)

**File:** `ipaper-api-resolver.ts`
**Name:** `ipaper`
**Requires browser:** Yes (Playwright)
**How it works:**

iPaper embeds page configuration in `window.staticSettings`:

```javascript
window.staticSettings = {
  pages: [1, 2, 3, ...],
  aws: {
    url: "https://s3-eu-west-1.amazonaws.com/...",
    policy: "Policy=...&Signature=...&Key-Pair-Id=..."
  }
};
```

The resolver:
1. Loads the iPaper URL in Playwright (needs a real browser for JavaScript execution)
2. Evaluates `window.staticSettings` to extract the page list and AWS signed URL
3. Constructs image URLs: `{aws.url}Pages/{pageNr}/Zoom.jpg?{aws.policy}`

**Why browser is needed:** The `staticSettings` are generated by JavaScript at runtime, not embedded as static HTML. The AWS signatures are short-lived.

**Zoom quality levels:** Normal, Large, Zoom. We use Zoom for maximum quality.

### 5. PDF (Müller)

**File:** `pdf-resolver.ts`
**Name:** `pdf`
**Requires browser:** Yes (Playwright + pdf.js)
**How it works:**

Some stores host their catalogs as direct PDF files (no viewer). The PDF resolver:
1. Downloads the PDF file server-side via `fetch()`
2. Base64-encodes the PDF data
3. Opens a Playwright page and loads pdf.js from CDN
4. Passes the base64 data to pdf.js in the browser context
5. Renders each page at 2x scale onto a `<canvas>` element
6. Extracts each page as a JPEG data URL (quality 0.85)
7. Returns `imageData` buffers (not URLs)

**Special behavior:** This is the only resolver that returns pre-rendered `imageData` buffers. The downloader writes these directly to storage without an additional download step.

**Why server-side download?** PDFs are downloaded server-side (in Node.js/Bun) before being passed to the browser, to avoid CORS restrictions that would prevent pdf.js from accessing cross-origin PDFs.

**Performance:** Rendering a 30-page PDF takes ~10-20 seconds (including pdf.js initialization).

### 6. FlipHTML5 (Animax)

**File:** `fliphtml5-resolver.ts`
**Name:** `fliphtml5`
**Requires browser:** Yes (Playwright)
**How it works:**

FlipHTML5 uses a WASM-based decoder (`deString.js`) to decode page data at runtime:

```javascript
window.fliphtml5_pages = [
  { n: "files/large/abc123.webp?ts=...", t: "...", l: "...", p: "..." },
  // ...
];
```

The resolver:
1. Loads the book URL with `waitUntil: "networkidle"` (wait for all network activity to stop)
2. Waits for `window.fliphtml5_pages` to be populated (up to 15 seconds)
3. Extracts the `n` (normal/large) field from each page object
4. Constructs full URLs: `{baseUrl}/{page.n}`

**Why `networkidle`?** The WASM decoder makes multiple network requests for config.js, deString.js, and the decoded page data. `networkidle` ensures all of this completes.

### 7. FlippingBook (Penny Romania)

**File:** `flippingbook-resolver.ts`
**Name:** `flippingbook`
**Requires browser:** No
**How it works:**

FlippingBook has a predictable image URL pattern:

```
{baseUrl}/files/assets/common/page-html5-substrates/page{NNNN}_{quality}.jpg
```

The resolver:
1. Fetches the base URL via HTTP
2. Scans the HTML for page links (`href="./2/"`, `href="./3/"`, etc.)
3. The highest page number found is the total page count
4. Constructs image URLs using the pattern above with quality level 3 (highest)
5. Page numbers are zero-padded to 4 digits (e.g., `page0001_3.jpg`)

### 8. Digital Catalogue (Auchan)

**File:** `digital-catalogue-resolver.ts`
**Name:** `digital-catalogue`
**Requires browser:** No
**How it works:**

digital-catalogue.com embeds page data in the HTML:

```javascript
"pagesNumber": 26
```

And images are stored at:
```
{origin}/storage/{account-storage}/{pub-id}/common/data/{NNNN}.webp
```

The resolver:
1. Fetches the page via HTTP (with browser User-Agent)
2. Extracts `pagesNumber` from the HTML
3. Extracts the storage path from image references in the HTML
4. Constructs image URLs: `{origin}/{storagePath}/{NNNN}.webp` (zero-padded to 4 digits)

### 9. Tjek (Netto)

**File:** `tjek-resolver.ts`
**Name:** `tjek`
**Requires browser:** Yes (Playwright)
**How it works:**

Tjek is a retail data platform. Catalogs are embedded as interactive viewers that load page images from a CDN:

```
https://image-transformer-api.tjek.com/.../uploads/{catalogId}/p-{pageNum}?w=700&...
```

The resolver:
1. Loads the store's prospekte page in Playwright
2. Waits 12 seconds for the Tjek widget to load
3. Clicks the catalog thumbnail (finds `img[src*='tjek.com']` and clicks its parent button/link)
4. Waits 8 seconds for the full viewer to open
5. Extracts all Tjek image URLs from the HTML using regex
6. Filters for page images (containing `/p-` and `w=700`)
7. Groups URLs by Tjek catalog ID, picks the one with the most pages
8. Sorts by page number and deduplicates

**Why clicking is needed:** The listing page only shows thumbnails. The full page URLs are only present after opening the viewer by clicking a thumbnail.

**URL decoding:** Tjek URLs often contain encoded slashes (`%2F`), HTML entities (`&amp;`), and Unicode escapes (`\u0026`). The resolver handles all three.

### 10. Browser Fallback

**File:** `resolver.ts`
**Name:** `browser`
**Requires browser:** Yes (Playwright, one browser instance per page)
**How it works:**

The browser resolver is the fallback when no platform-specific resolver exists. It treats the catalog as a multi-page website and extracts images from each page:

1. During discovery, the last page is determined via binary search:
   - Probe pages 10, 20, 40, 60, 80, 100, 120
   - When a page fails (returns 404, redirects, or has no large images), binary search between last valid and first invalid
2. During resolution, for each page:
   - Navigate to the page URL
   - Wait for images to load
   - Find the largest image (>500x500px, not in nav/sidebar/thumbnails)
   - Extract the image `src` URL
3. Browser context is refreshed every 15 pages to avoid rate-limiting
4. Default delay of 3 seconds between pages

**Performance:** Very slow — ~5 seconds per page (navigation + wait + extraction). A 60-page catalog takes ~5 minutes. Always prefer a platform-specific resolver.

**When to use:** Only when no API or predictable URL pattern exists. Currently only used as a fallback for stores where the specific platform isn't identified.

## How to Write a New Resolver

### Step 1: Research the Platform

Before writing code, understand how the platform serves page images:

1. Open a catalog in DevTools
2. Check the Network tab — is there a JSON API that returns page URLs?
3. Check the Elements tab — are page image URLs in the HTML?
4. Check the Console — does `window.` expose any page data?
5. Look for patterns in the image URLs — can you construct URLs from a base URL + page number?

### Step 2: Create the Resolver File

Create `packages/scraper/src/scraping/my-platform-resolver.ts`:

### Step 3: Register in Pipeline

Add the side-effect import in `packages/scraper/src/pipeline.ts`:

```typescript
import "./scraping/my-platform-resolver.ts";
```

### Step 4: Add Auto-Detection Rule (Optional)

If the platform can be identified from URLs, add a rule in `resolver-registry.ts`:

```typescript
const detectionRules: DetectionRule[] = [
  // ... existing rules ...
  {
    test: (url) => url.includes("my-platform.com"),
    resolverName: "my-platform",
  },
];
```

### Template: HTTP-Only Resolver

For platforms with a predictable API or URL pattern:

```typescript
import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

async function resolveViaMyPlatform(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  // 1. Extract identifier from URL
  const match = firstPageUrl.match(/my-pattern\/([^/]+)/);
  if (!match) throw new Error(`Cannot parse URL: ${firstPageUrl}`);
  const id = match[1]!;

  // 2. Fetch API/data
  const apiUrl = `https://api.my-platform.com/catalogs/${id}/pages`;
  console.log(`[my-platform] fetching ${apiUrl}`);
  const resp = await fetch(apiUrl);
  if (!resp.ok) throw new Error(`API returned ${resp.status}`);
  const data = await resp.json();

  // 3. Build page list
  const pages: ResolvedPage[] = data.pages.map((p: any, i: number) => ({
    number: i + 1,
    imageUrl: p.imageUrl,
  }));

  console.log(`[my-platform] got ${pages.length} pages for ${catalogId}`);

  return {
    catalogId,
    coverImageUrl: pages[0]?.imageUrl ?? "",
    pages,
  };
}

const myPlatformResolver: CatalogResolver = {
  name: "my-platform",
  needsLastPage: false,
  resolve: resolveViaMyPlatform,
};

registerResolver(myPlatformResolver);
```

### Template: Browser-Based Resolver

For platforms that require JavaScript execution:

```typescript
import { chromium } from "../browser.ts";
import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

async function resolveViaMyPlatform(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  console.log(`[my-platform] loading ${firstPageUrl}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(firstPageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    // Extract data from the page
    const pageData = await page.evaluate(() => {
      // Access window.* or DOM to find page URLs
      return (window as any).myPlatformPages;
    });

    if (!pageData?.length) {
      throw new Error(`No pages found on: ${firstPageUrl}`);
    }

    const pages: ResolvedPage[] = pageData.map((url: string, i: number) => ({
      number: i + 1,
      imageUrl: url,
    }));

    console.log(`[my-platform] got ${pages.length} pages for ${catalogId}`);

    return {
      catalogId,
      coverImageUrl: pages[0]?.imageUrl ?? "",
      pages,
    };
  } finally {
    await browser.close();
  }
}

const myPlatformResolver: CatalogResolver = {
  name: "my-platform",
  needsLastPage: false,
  resolve: resolveViaMyPlatform,
};

registerResolver(myPlatformResolver);
```

## Resolver Decision Matrix

When deciding how to resolve a new store's catalogs:

```
Does the platform have a public JSON API?
  ├── Yes → Write an HTTP-only resolver (fastest, most reliable)
  │         Examples: Leaflets, Publitas, Yumpu
  │
  └── No → Does JavaScript populate page data on the client?
           ├── Yes → Write a browser-based resolver
           │         Extract from window.* or DOM after JS executes
           │         Examples: iPaper, FlipHTML5, Tjek
           │
           └── No → Are image URLs predictable from the page HTML?
                    ├── Yes → Write an HTTP-only resolver
                    │         Fetch HTML, regex out the pattern
                    │         Examples: FlippingBook, Digital Catalogue
                    │
                    └── No → Is the catalog a direct PDF file?
                             ├── Yes → Use the PDF resolver
                             │
                             └── No → Use the browser fallback
                                      (last resort, very slow)
```

**Priority order for resolver implementation:**
1. HTTP-only with JSON API (fastest, most reliable)
2. HTTP-only with HTML parsing (fast, but fragile to HTML changes)
3. Browser-based with JS extraction (slower, but handles dynamic content)
4. Browser fallback (slowest, use only temporarily)
