# Contributing to BestDeal

The easiest way to contribute is by **adding a new store**. You don't need to understand the full codebase — just create a JSON config file and test it.

## Adding a New Store

### 1. Find the store's catalog page

Visit the store's website and find where they publish their weekly catalogs/prospekte/flyers. Note:
- The URL of the page that lists catalogs
- What platform hosts the catalog viewer (look at the URL when you open a catalog)
- How dates are displayed (on the page text, in the URL slug, or both)

### 2. Identify the catalog platform

The scraper has resolvers for these platforms. Check if your store uses one of them:

| Platform | How to identify | Resolver name |
|----------|----------------|---------------|
| **Leaflets** (Schwarz) | URL contains `leaflets.schwarz` or `leaflets.kaufland` | `leaflets` |
| **Publitas** | URL contains `publitas.com` or has `/spreads.json` endpoint | `publitas` |
| **iPaper** | URL contains `ipapercms.dk` or `ipaper.io` | `ipaper` |
| **Yumpu** | URL contains `yumpu.com` | `yumpu` |
| **FlipHTML5** | URL contains `fliphtml5.com` or page has `fliphtml5_pages` | `fliphtml5` |
| **FlippingBook** | URL contains `files.rewe.co.at` | `flippingbook` |
| **Digital Catalogue** | URL contains `digital-catalogue.com` | `digital-catalogue` |
| **Tjek** | Images from `image-transformer-api.tjek.com` | `tjek` |
| **PDF** | Direct link to a `.pdf` file | `pdf` |

If the platform isn't listed, the `browser` resolver (Playwright screenshots) may work as a fallback, but it's slow. Consider opening an issue to discuss adding a new resolver.

### 3. Create the store config

Create a JSON file at `packages/scraper/stores/{country}/{store}.json`:

```json
{
    "name": "my-store",
    "landingUrl": "https://www.my-store.de/prospekte",
    "waitAfterLoad": 8000,
    "linkPatterns": [
        {
            "match": "viewer\\.example\\.com/([^/]+)/page/\\d+",
            "slugGroup": 1,
            "normalizeUrl": []
        }
    ],
    "dateSource": "text",
    "datePatterns": [
        {
            "match": "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s*-\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})",
            "dateFrom": "$1-$2-$3",
            "dateTo": "$4-$5-$6"
        }
    ]
}
```

### Config fields explained

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Store name (lowercase, hyphens for spaces). Must match the filename. |
| `landingUrl` | Yes | URL of the page that lists catalogs. The scraper loads this with Playwright. |
| `waitAfterLoad` | Yes | Milliseconds to wait after page load for JS to render (3000-12000). |
| `resolver` | No | Force a specific resolver. If omitted, auto-detected from the catalog URL. |
| `linkDomain` | No | Only match links from this domain (e.g. `leaflets.kaufland.com`). |
| `linkSelector` | No | CSS selector for elements containing catalog URLs (default: `a[href]` + `iframe[src]`). |
| `linkAttribute` | No | Attribute to read the URL from (default: `href`/`src`). Use with `linkSelector`. |
| `linkPatterns` | Yes | Array of patterns to match catalog URLs. See below. |
| `dateSource` | Yes | Where to find dates: `"slug"`, `"text"`, or `"slug_then_text"`. |
| `datePatterns` | Yes | Regex patterns to extract dates. See below. |
| `catalogTypePattern` | No | Pattern to extract catalog type from URL (e.g. "leaflet", "magazine"). |
| `iframeExtract` | No | Regex to match iframe src on the linked page (for stores that embed catalogs in iframes). |

### Link patterns

Each pattern matches catalog URLs found on the landing page:

```json
{
    "match": "leaflets\\.kaufland\\.com",
    "slugGroup": 1,
    "normalizeUrl": [
        { "type": "replace", "match": "/page/\\d+", "replacement": "/page/1" }
    ]
}
```

- `match` — Regex to test against the URL. Must have a capture group for the slug.
- `slugGroup` — Which capture group is the catalog slug (0 = full URL, 1 = first group).
- `normalizeUrl` — Transforms to apply to the URL. Types: `replace`, `append`, `else`.

### Date patterns

Each pattern extracts `dateFrom` and `dateTo` from the slug or surrounding text:

```json
{
    "match": "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s*-\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})",
    "dateFrom": "$1-$2-$3",
    "dateTo": "$4-$5-$6"
}
```

- `match` — Regex with capture groups for date parts.
- `dateFrom` / `dateTo` — Templates using `$1`, `$2`, etc. for captured groups.
- Dates are then converted to ISO format by `toISODate()`. Supported formats:
  - `DD-MM-YYYY` (e.g. `09-03-2026`)
  - `DD-MM` (year inferred from dateTo)
  - `DD-monthname` (e.g. `16-März`, month names in Romanian/German/French)
  - `KW{n}-{yy}` (calendar week, e.g. `KW11-26` = Mon Mar 9 to Sat Mar 14)

### 4. Test your config

```bash
# Test discovery (finds catalogs, doesn't download)
bun run scraper -- --country=germany --store=my-store --discover-only

# You should see output like:
# [discovery] new catalog: germany-my-store-2026-03-16-2026-03-21 — resolver "publitas"
```

If you see `(no dates)`, your date patterns don't match the text. Try adjusting them.

If you see no catalogs at all, your link patterns don't match any URLs on the page.

### 5. Full scrape test

```bash
# Download catalog images to local filesystem
bun run scraper -- --country=germany --store=my-store
```

Check `packages/data/catalogs/germany/my-store/` for the downloaded images.

### 6. Submit a PR

- One store per PR
- Include the store config JSON file
- Mention what platform the store uses and how you identified the URL patterns

## Adding a New Country

1. Create a directory: `packages/scraper/stores/{country}/`
2. Add store configs inside it
3. Add the country metadata to `packages/shared/src/types/country.ts` (name, flag emoji)
4. Test with `bun run scraper -- --country={country} --discover-only`

## Adding a New Resolver

If a store uses a platform not yet supported:

1. Create `packages/scraper/src/scraping/{platform}-resolver.ts`
2. Implement the `CatalogResolver` interface:
   ```typescript
   interface CatalogResolver {
     name: string;
     needsLastPage: boolean;
     resolve(input: ResolveInput): Promise<ResolveResult>;
   }
   ```
3. Call `registerResolver(myResolver)` at the bottom of the file
4. Add a URL detection rule in `resolver-registry.ts`
5. Add the side-effect import in `pipeline.ts`

Look at `publitas-api-resolver.ts` for a simple example (fetch JSON, return image URLs).

## Development

### Project structure

```
packages/shared/src/
  types/          — TypeScript interfaces
  utils/          — Date parsing, catalog ID, URL transforms
  storage/        — Read adapters (filesystem, R2, CDN)

packages/scraper/src/
  cli.ts          — CLI entry point, argument parsing
  pipeline.ts     — Orchestrates discovery → scraping → manifest
  config/         — Store config loader
  discovery/      — Discovery engine (Playwright-based)
  scraping/       — Resolvers + downloader
  storage/        — Write adapters (filesystem, R2)

packages/web/src/
  app/            — Next.js pages (edge runtime)
  components/     — React components
  lib/            — Storage client, image URL helper
```

### Running tests

```bash
bun test packages/                    # All tests
bun test packages/scraper/tests/      # Scraper only
bun test packages/shared/tests/       # Shared only
```

### Building for Cloudflare

```bash
cd packages/web
NEXT_PUBLIC_CDN_URL=https://cdn.best-deal-shops.com bun run build:cf
```
