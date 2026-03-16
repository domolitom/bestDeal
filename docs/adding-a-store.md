# How to Add a New Store

This guide walks through the complete process of adding a new store to bestDeal — from researching the store's catalog page to having it live on the website.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Overview of the Process](#overview-of-the-process)
- [Step 1: Research the Store](#step-1-research-the-store)
- [Step 2: Identify the Catalog Platform](#step-2-identify-the-catalog-platform)
- [Step 3: Understand the URL Structure](#step-3-understand-the-url-structure)
- [Step 4: Write the Store Config](#step-4-write-the-store-config)
- [Step 5: Test Discovery](#step-5-test-discovery)
- [Step 6: Test Full Scraping](#step-6-test-full-scraping)
- [Step 7: Upload to R2](#step-7-upload-to-r2)
- [Step 8: Verify on the Website](#step-8-verify-on-the-website)
- [Step 9: Add to GitHub Actions](#step-9-add-to-github-actions)
- [Troubleshooting](#troubleshooting)
- [Real-World Examples](#real-world-examples)
  - [Simple: Publitas Store](#simple-publitas-store)
  - [Medium: iPaper Store with Text Dates](#medium-ipaper-store-with-text-dates)
  - [Complex: Custom Selector + Iframe Extraction](#complex-custom-selector--iframe-extraction)
  - [API-Based: Carrefour-Style](#api-based-carrefour-style)

---

## Prerequisites

- Bun installed (`~/.bun/bin/bun`)
- Playwright browsers installed: `cd packages/scraper && bunx playwright install chromium --with-deps`
- For R2 uploads: `.env.local` with R2 credentials

## Overview of the Process

Adding a store requires exactly **one file**: a JSON config at `packages/scraper/stores/{country}/{store}.json`. No code changes are needed unless the store uses a platform that doesn't have a resolver yet.

The process is:
1. Research the store's catalog/flyer page
2. Identify which platform hosts their catalogs
3. Analyze the URL structure and date format
4. Write a store config JSON file
5. Test discovery (does it find catalogs?)
6. Test full scraping (does it download page images?)
7. Upload to R2 and verify on the website
8. Add the country to the GitHub Actions matrix (if new country)

## Step 1: Research the Store

Visit the store's website and find their catalog/flyer/prospekte page. Common URL patterns:

- `/catalogs`, `/cataloage`, `/kataloge`, `/prospekte`
- `/flyers`, `/leaflets`, `/brosuri`
- `/offers`, `/angebote`, `/promos`
- `/campaign` (JYSK)
- `/aktuelles/prospekte-und-kataloge` (Hornbach)

**What to look for:**
- Is there a page listing current catalogs with links?
- What domain do the catalog links point to? (e.g., `ipapercms.dk`, `view.publitas.com`, `leaflets.schwarz`)
- How are dates displayed? (DD.MM.YYYY, DD/MM, text like "du 10 au 16 mars")
- Are there multiple catalog types? (weekly, monthly, special offers)
- Does the page require JavaScript to render? (heavy SPAs may need longer `waitAfterLoad`)

## Step 2: Identify the Catalog Platform

Open browser DevTools and inspect the catalog links. Look at where they point:

| Platform | How to recognize | Resolver |
|----------|-----------------|----------|
| **Lidl/Kaufland leaflets** | URL contains `leaflets.schwarz` or `leaflets.kaufland` | `leaflets` |
| **Publitas** | URL contains `view.publitas.com` or custom domain with `/page/N` path | `publitas` |
| **iPaper** | URL contains `ipapercms.dk`, `ipaper.io`, or `/CampaignPaper/` | `ipaper` |
| **Yumpu** | URL contains `yumpu.com/*/document/read/` | `yumpu` |
| **FlipHTML5** | URL contains `fliphtml5.com` | `fliphtml5` |
| **FlippingBook** | HTML contains `page-html5-substrates` or `href="./2/"` patterns | `flippingbook` |
| **digital-catalogue.com** | URL or iframe contains `digital-catalogue.com` | `digital-catalogue` |
| **Tjek** | Images from `image-transformer-api.tjek.com` | `tjek` |
| **Direct PDF** | Link points to a `.pdf` file | `pdf` |
| **Unknown/Custom** | None of the above | May need a new resolver or `browser` fallback |

**Pro tip:** Check the Network tab in DevTools. Many platforms load their page data from JSON APIs — these are often easier to work with than scraping HTML.

## Step 3: Understand the URL Structure

Once you know the platform, you need to understand:

1. **The landing page URL** — The page that lists all current catalogs
2. **The link pattern** — How catalog URLs look and what parts identify the catalog
3. **The slug** — What part of the URL uniquely identifies a catalog
4. **The date format** — How dates appear in the slug or surrounding text

### Analyzing Link Patterns

Open the landing page and inspect each catalog link. Look for patterns:

```
https://view.publitas.com/hornbach-baumarkt/gartenkatalog-010326-310326/page/1
                          ↑ store         ↑ slug with dates          ↑ page number
```

The regex pattern for this would be:
```
view\.publitas\.com/hornbach[^/]*/([^/?#]+)/page/\d+
```
Where capture group 1 is the slug: `gartenkatalog-010326-310326`

### Analyzing Date Formats

Look at how dates appear. Common formats:

| Format | Example | Region |
|--------|---------|--------|
| DD.MM.YYYY | 14.03.2026 | Germany, Romania |
| DD/MM/YYYY | 14/03/2026 | France |
| DD-MM-YYYY | 14-03-2026 | General |
| DD.MM - DD.MM.YYYY | 14.03 - 21.03.2026 | Common in DE/RO |
| du DD/MM au DD/MM/YYYY | du 14/03 au 21/03/2026 | France |
| KW{n}-{yy} | kw11-26 | Aldi Süd (calendar weeks) |
| DDMMYY-DDMMYY | 010326-310326 | Hornbach in slugs |
| Month name | 14 martie - 21 martie | Romania |

## Step 4: Write the Store Config

Create a new file at `packages/scraper/stores/{country}/{store-name}.json`:

### Minimal Config (Publitas with slug dates)

```json
{
    "name": "my-store",
    "landingUrl": "https://www.my-store.de/prospekte/",
    "waitAfterLoad": 8000,
    "linkDomain": "view.publitas.com",
    "linkPatterns": [
        {
            "match": "view\\.publitas\\.com/my-store/([^/?#]+)/page/\\d+",
            "slugGroup": 1,
            "normalizeUrl": []
        }
    ],
    "dateSource": "slug",
    "datePatterns": [
        {
            "match": "(\\d{2})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})(\\d{2})",
            "dateFrom": "$1-$2-20$3",
            "dateTo": "$4-$5-20$6"
        }
    ]
}
```

### Config with Text-Based Dates

```json
{
    "name": "my-store",
    "landingUrl": "https://www.my-store.ro/cataloage",
    "waitAfterLoad": 10000,
    "linkDomain": "ipapercms.dk",
    "linkPatterns": [
        {
            "match": "ipapercms\\.dk/my-store/ro/CampaignPaper/([a-f0-9_-]+)",
            "slugGroup": 1,
            "normalizeUrl": [
                { "type": "replace", "match": "\\?.*$", "replacement": "" }
            ]
        }
    ],
    "dateSource": "text",
    "datePatterns": [
        {
            "match": "(\\d{1,2})\\.(\\d{2})\\.(\\d{4})\\s*-\\s*(\\d{1,2})\\.(\\d{2})\\.(\\d{4})",
            "dateFrom": "$1-$2-$3",
            "dateTo": "$4-$5-$6"
        },
        {
            "match": "(\\d{1,2})\\.(\\d{2})\\s*-\\s*(\\d{1,2})\\.(\\d{2})\\.(\\d{4})",
            "dateFrom": "$1-$2",
            "dateTo": "$3-$4-$5"
        }
    ]
}
```

### Key Fields Explained

- **`name`**: Must match the filename (without `.json`). Use lowercase kebab-case.
- **`landingUrl`**: The page that lists all current catalogs. This is what Playwright navigates to.
- **`waitAfterLoad`**: How long to wait (ms) after `domcontentloaded` for JavaScript/AJAX to finish. Start with 8000-10000. Increase if content doesn't appear.
- **`linkDomain`**: Optional filter. If set, only links containing this domain are considered. Greatly reduces noise.
- **`linkPatterns`**: Regex patterns to match catalog URLs. The `slugGroup` capture group becomes the catalog slug. `normalizeUrl` transforms are applied to produce the `firstPageUrl`.
- **`dateSource`**: Where to find dates. Use `"slug"` if dates are in the URL, `"text"` if they're on the page, `"slug_then_text"` to try both.
- **`datePatterns`**: Regex patterns with `$N` group references. `dateFrom` and `dateTo` templates are filled with captured groups.
- **`resolver`**: Only needed if auto-detection from the URL doesn't work. For example, `"resolver": "leaflets"` for Lidl when the URL doesn't contain `leaflets.schwarz`.

### Tips for Writing Patterns

1. **Escape dots in domain names:** `view\\.publitas\\.com` not `view.publitas.com`
2. **Use `[^/?#]+` for slug capture:** Matches everything up to a query string, hash, or slash
3. **Multiple date patterns are fine:** They're tried in order, first match wins. Put the most specific pattern first.
4. **Test your regex:** Use regex101.com with the actual URLs from the store
5. **Always include `normalizeUrl: []`** even if empty — it's required by the schema

## Step 5: Test Discovery

Run the scraper in discover-only mode:

```bash
bun run scraper -- --discover-only --country=germany --store=my-store
```

**What to look for:**
- `[discovery] found N my-store catalog(s)` in the log output — Did it find catalogs?
- Are the catalog IDs correct? (correct country, store, dates)
- Are the dates in ISO format? (YYYY-MM-DD)
- Is the resolver correctly detected?

**Common issues:**
- `found 0 catalogs` → Link pattern doesn't match. Check the regex against actual URLs on the page.
- `no dates` → Date pattern doesn't match. Check the regex against the actual slug or text.
- Wrong dates → Date pattern groups are in the wrong order. Check `$1`, `$2`, etc.
- Duplicate catalogs → Multiple link patterns match the same catalog. Add more specificity.

## Step 6: Test Full Scraping

Once discovery works, run the full pipeline to a local filesystem:

```bash
bun run scraper -- --country=germany --store=my-store
```

This downloads catalog page images to `data/catalogs/germany/my-store/`. Check:
- Are images being downloaded? (`page-001.jpg`, `page-002.jpg`, etc.)
- Do the images look correct? (not error pages, login screens, or thumbnails)
- Is the page count reasonable? (a typical catalog has 10-60 pages)
- Is there a `cover.jpg`?

## Step 7: Upload to R2

Once local testing passes, run with R2 storage:

```bash
source .env.local
bun run scraper -- --storage=r2 --country=germany --store=my-store
```

This uploads everything to the R2 bucket and generates the country manifest.

## Step 8: Verify on the Website

Visit `https://best-deal-shops.com/{country}` and check that:
- The store appears in the store list
- Catalog cards show correct cover images and date ranges
- The catalog viewer works and shows all pages

## Step 9: Add to GitHub Actions

If this is a new country (not romania, germany, or france), add it to the GitHub Actions matrix in `.github/workflows/scrape.yml`:

```yaml
strategy:
  matrix:
    country: [romania, germany, france, my-new-country]
```

If the country is already in the matrix, no changes are needed — the cron job will automatically pick up the new store.

## Troubleshooting

### "found 0 catalogs"

1. **Check `waitAfterLoad`** — The page might need more time. Try increasing to 15000-20000.
2. **Check `linkDomain`** — Is it filtering out the right links? Remove it temporarily to see all links.
3. **Check link patterns** — Open the page in a browser, find the catalog link, and test your regex against it.
4. **Check for JavaScript rendering** — Some pages use heavy SPAs. The content might not be in the DOM when Playwright captures it.
5. **Check for bot detection** — Some sites block automated browsers. The stealth plugin handles most cases, but some sites use aggressive detection.

### "no dates" for all catalogs

1. **Check date source** — If dates aren't in the slug, switch to `"text"` or `"slug_then_text"`.
2. **Check date patterns** — Copy the actual text containing dates and test your regex against it.
3. **Check for localized dates** — French uses `/`, German uses `.`, Romanian uses full month names. Make sure your patterns match the local format.
4. **Check for surrounding text** — The discovery engine looks for dates in the nearest "card" container. If the page structure is unusual, dates might not be in the right context.

### Resolver returns 0 pages

1. **Check the resolver** — Is auto-detection picking the right one? Add `"resolver": "publitas"` (or whichever) to force it.
2. **Check the URL** — Does the `firstPageUrl` in meta.json look correct? Try opening it in a browser.
3. **Platform-specific issues:**
   - Publitas: Check if `spreads.json` returns data for that URL
   - iPaper: Check if `window.staticSettings` is present
   - FlipHTML5: Wait might be too short for WASM decoder

### Images are wrong (error pages, thumbnails, etc.)

1. **Check image extraction** — The browser resolver uses heuristics to find the largest image. If the page layout is unusual, it might pick the wrong one.
2. **Check for hotlink protection** — Some CDNs check the Referer header. The downloader sets it, but some are stricter.
3. **Check for signed URLs** — Some platforms (iPaper, Tjek) use time-limited signed URLs. If too much time passes between resolution and download, URLs may expire.

## Real-World Examples

### Simple: Publitas Store

**Hornbach Germany** — A DIY store with catalogs on Publitas:

```json
{
    "name": "hornbach",
    "landingUrl": "https://www.hornbach.de/aktuelles/prospekte-und-kataloge/",
    "waitAfterLoad": 10000,
    "linkDomain": "view.publitas.com",
    "linkPatterns": [
        {
            "match": "view\\.publitas\\.com/hornbach[^/]*/([^/?#]+)/page/\\d+",
            "slugGroup": 1,
            "normalizeUrl": []
        },
        {
            "match": "view\\.publitas\\.com/hornbach[^/]*/([^/?#]+)/?$",
            "slugGroup": 1,
            "normalizeUrl": [
                { "type": "replace", "match": "/?$", "replacement": "/page/1" }
            ]
        }
    ],
    "resolver": "publitas",
    "dateSource": "slug_then_text",
    "datePatterns": [
        {
            "match": "(\\d{2})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})(\\d{2})",
            "dateFrom": "$1-$2-20$3",
            "dateTo": "$4-$5-20$6"
        },
        {
            "match": "(\\d{1,2})\\.(\\d{2})\\.(\\d{4})\\s*(?:bis|-|–)\\s*(\\d{1,2})\\.(\\d{2})\\.(\\d{4})",
            "dateFrom": "$1-$2-$3",
            "dateTo": "$4-$5-$6"
        }
    ]
}
```

**Why two link patterns?** Some Publitas links include `/page/N`, others don't. The second pattern appends `/page/1` for normalization.

**Why `slug_then_text`?** The slug often contains dates in DDMMYY format. If not (e.g., named slugs like `gartenkatalog`), fall back to text on the page.

### Medium: iPaper Store with Text Dates

**JYSK France** — Furniture store with catalogs on iPaper:

```json
{
    "name": "jysk",
    "landingUrl": "https://jysk.fr/campaign",
    "waitAfterLoad": 10000,
    "linkDomain": "ipapercms.dk",
    "linkPatterns": [
        {
            "match": "ipapercms\\.dk/jysk/fr/CampaignPaper/([a-f0-9_-]+)",
            "slugGroup": 1,
            "normalizeUrl": [
                { "type": "replace", "match": "\\?.*$", "replacement": "" }
            ]
        }
    ],
    "dateSource": "text",
    "datePatterns": [
        {
            "match": "du (\\d{2})/(\\d{2}) au (\\d{2})/(\\d{2})/(\\d{4})",
            "dateFrom": "$1-$2",
            "dateTo": "$3-$4-$5"
        },
        {
            "match": "du (\\d{2})/(\\d{2})/(\\d{4}) au (\\d{2})/(\\d{2})/(\\d{4})",
            "dateFrom": "$1-$2-$3",
            "dateTo": "$4-$5-$6"
        }
    ]
}
```

**Why `dateSource: "text"`?** iPaper slugs are hex UUIDs (`a1b2c3d4_e5f6_...`) — they don't contain dates. Dates are in the surrounding text: "du 10/03 au 16/03/2026".

**Why strip query params?** iPaper URLs often have tracking params (`?page=1&utm_source=...`) that should be removed for consistent slugs.

**French date patterns:** Note the `du ... au ...` format specific to French. Each country/language needs its own date patterns.

### Complex: Custom Selector + Iframe Extraction

**Auchan Romania** — Hypermarket with catalogs on digital-catalogue.com, embedded via iframes:

```json
{
    "name": "auchan",
    "landingUrl": "https://www.auchan.ro/cataloagele-auchan",
    "waitAfterLoad": 8000,
    "resolver": "digital-catalogue",
    "iframeExtract": "digital-catalogue\\.com",
    "linkPatterns": [
        {
            "match": "/cataloagele-auchan/(catalog-[^/]+)",
            "slugGroup": 1,
            "normalizeUrl": []
        }
    ],
    "dateSource": "text",
    "datePatterns": [
        {
            "match": "(\\d{1,2})\\.(\\d{2})\\.(\\d{4})\\s*-\\s*(\\d{1,2})\\.(\\d{2})\\.(\\d{4})",
            "dateFrom": "$1-$2-$3",
            "dateTo": "$4-$5-$6"
        }
    ]
}
```

**Why `iframeExtract`?** Auchan's landing page links to internal catalog pages (`/cataloagele-auchan/catalog-fresh-food`). These pages embed the digital-catalogue viewer in an iframe. The `iframeExtract` pattern tells the discovery engine to visit each linked page, find the iframe matching `digital-catalogue.com`, and use that URL as the `firstPageUrl`.

**Why `resolver: "digital-catalogue"`?** Without this, the auto-detection wouldn't know which resolver to use because the catalog links on the landing page are internal Auchan URLs, not digital-catalogue.com URLs. The resolver override ensures the correct resolver is used.

### API-Based: Carrefour-Style

**Carrefour Romania** — Supermarket with a custom API for catalog metadata:

```json
{
    "name": "carrefour",
    "landingUrl": "https://carrefour.ro/corporate/cataloage",
    "waitAfterLoad": 10000,
    "linkPatterns": [],
    "dateSource": "text",
    "datePatterns": [
        {
            "match": "(\\d{2})-(\\d{2})-(\\d{4})",
            "dateFrom": "$1-$2-$3",
            "dateTo": "$1-$2-$3"
        }
    ],
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

**Why `apiDiscovery`?** Carrefour doesn't embed catalog URLs directly in the HTML. Instead, catalog elements have a `data-catalog` attribute with an ID. The discovery engine calls the Carrefour API for each ID to get the actual catalog URL and dates.

**Why empty `linkPatterns`?** When `apiDiscovery` is present, link patterns aren't used. The API provides the `firstPageUrl` directly.

**Why `datePatterns` with `apiDiscovery`?** The date patterns are used to parse the dates returned by the API if they need normalization. In this case, the API returns dates in DD-MM-YYYY format.
