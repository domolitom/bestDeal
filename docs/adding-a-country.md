# How to Add a New Country

This guide explains how to add support for a new country to bestDeal — from registering the country metadata to having its catalogs live on the website.

## Table of Contents

- [Overview](#overview)
- [Step 1: Add Country Metadata](#step-1-add-country-metadata)
- [Step 2: Create the Country Directory](#step-2-create-the-country-directory)
- [Step 3: Add Store Configs](#step-3-add-store-configs)
- [Step 4: Test Locally](#step-4-test-locally)
- [Step 5: Upload to R2](#step-5-upload-to-r2)
- [Step 6: Add to GitHub Actions Matrix](#step-6-add-to-github-actions-matrix)
- [Step 7: Verify on the Website](#step-7-verify-on-the-website)
- [Tips for Multi-Country Stores](#tips-for-multi-country-stores)
- [Country-Specific Date Formats](#country-specific-date-formats)

---

## Overview

Adding a new country requires changes in three places:
1. **Country metadata** in `packages/shared/src/types/country.ts` — Display name and flag emoji
2. **Store configs** in `packages/scraper/stores/{country}/` — At least one store JSON file
3. **GitHub Actions** in `.github/workflows/scrape.yml` — Add the country to the matrix

The web app automatically picks up new countries from the CDN manifests — no web app changes needed.

## Step 1: Add Country Metadata

Edit `packages/shared/src/types/country.ts` and add an entry to `COUNTRY_META`:

```typescript
export const COUNTRY_META: Record<string, { name: string; flag: string }> = {
  // ... existing entries ...
  turkey: { name: "Turkey", flag: "🇹🇷" },
};
```

**Rules:**
- The key must be the **full country name in lowercase English** (e.g., `romania`, `germany`, `czechia`)
- This key is used everywhere: folder names, catalog IDs, URL paths, storage keys
- Do NOT use 2-letter ISO codes — the project uses full names consistently

**Finding flag emojis:** Use the two-letter country code mapped to Regional Indicator Symbols. For example, Turkey (TR) = 🇹🇷. On macOS, use the emoji picker (Ctrl+Cmd+Space).

## Step 2: Create the Country Directory

Create the folder for store configs:

```bash
mkdir packages/scraper/stores/turkey
```

The directory name must exactly match the key you added to `COUNTRY_META`.

## Step 3: Add Store Configs

Add at least one store config JSON file. See [adding-a-store.md](./adding-a-store.md) for the full guide.

For a new country, the easiest starting points are stores that already have resolvers in other countries:

### Quick Wins — Stores Present in Many Countries

**Lidl** (present in 24+ European countries):
- Landing URL pattern: `https://www.lidl.{tld}/c/{catalog-path}/{id}`
- The catalog URL structure varies by country — you need to check the actual site
- Resolver: `leaflets` (must be set manually since auto-detection depends on URL format)
- Each country has its own `leaflets.schwarz` API endpoint

**JYSK** (present in 20+ European countries):
- Landing URL: `https://jysk.{tld}/campaign`
- iPaper links: `ipapercms.dk/jysk/{countryCode}/CampaignPaper/...`
- Resolver: `ipaper` (auto-detected from `ipapercms.dk`)
- Date format varies by country language

**Kaufland** (DE, PL, CZ, HR, BG, SK, RO, MD):
- Uses the leaflets API (same as Lidl)
- Landing URL structure varies by country

### Template: JYSK for a New Country

For a country where JYSK operates, you can adapt this template:

```json
{
    "name": "jysk",
    "landingUrl": "https://jysk.{tld}/campaign",
    "waitAfterLoad": 10000,
    "linkDomain": "ipapercms.dk",
    "linkPatterns": [
        {
            "match": "ipapercms\\.dk/jysk/{countryCode}/CampaignPaper/([a-f0-9_-]+)",
            "slugGroup": 1,
            "normalizeUrl": [
                { "type": "replace", "match": "\\?.*$", "replacement": "" }
            ]
        }
    ],
    "dateSource": "text",
    "datePatterns": [
        // Add date patterns for the local language
    ]
}
```

Replace `{tld}` with the country TLD and `{countryCode}` with the 2-letter code used by iPaper.

## Step 4: Test Locally

```bash
# Test discovery
bun run scraper -- --discover-only --country=turkey

# Test full pipeline
bun run scraper -- --country=turkey
```

Check:
- Catalogs are discovered with correct IDs and dates
- Page images download successfully
- Images look correct (not error pages)

## Step 5: Upload to R2

```bash
source .env.local
bun run scraper -- --storage=r2 --country=turkey
```

This creates:
- `turkey/manifest.json` in R2
- `turkey/{store}/{catalogId}/meta.json` + images for each catalog

## Step 6: Add to GitHub Actions Matrix

Edit `.github/workflows/scrape.yml`:

```yaml
strategy:
  fail-fast: false
  matrix:
    country: [romania, germany, france, turkey]  # Add here
```

This ensures the country is scraped automatically on the Mon/Thu schedule.

**Important:** Each country runs as a separate parallel job. The `fail-fast: false` flag means a failure in one country doesn't stop others.

**Timeout:** The default timeout is 30 minutes per country. If the new country has many stores or slow resolvers, you may need to increase this.

## Step 7: Verify on the Website

The web app automatically picks up new countries. Visit:
- `https://best-deal-shops.com/` — Should show the new country in the selector
- `https://best-deal-shops.com/turkey` — Should show the country's catalogs
- `https://best-deal-shops.com/turkey/{store}` — Store-filtered view

The `CdnReadAdapter` fetches manifests for all countries in `COUNTRY_META` on each request, so as soon as the manifest exists in R2, the country appears on the site.

## Tips for Multi-Country Stores

### Same Store, Different Countries

When a store operates in multiple countries (Lidl, JYSK, Kaufland), each country gets its own config file. The configs are usually similar but differ in:

1. **`landingUrl`** — Different TLD and path structure
2. **`linkPatterns`** — URL patterns may include country-specific paths
3. **`datePatterns`** — Date formats depend on the local language
4. **`dateSource`** — Some countries put dates in the slug, others in text

### Sharing Resolver Logic

Resolvers are platform-based, not store-based. If a store uses iPaper in Romania and France, both configs use the same `ipaper` resolver. No per-country resolver changes are needed.

### Country-Specific iPaper Paths

iPaper URLs include a country code: `ipapercms.dk/jysk/ro/CampaignPaper/...` vs `ipapercms.dk/jysk/fr/CampaignPaper/...`. Each country config must use the correct code in its `linkPatterns.match`.

## Country-Specific Date Formats

Date patterns need to match the local language and format. Here are common formats by region:

### German-Speaking (DE, AT, CH)

```json
[
    {
        "match": "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s*(?:bis|-|–)\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})",
        "dateFrom": "$1-$2-$3",
        "dateTo": "$4-$5-$6"
    },
    {
        "match": "(\\d{1,2})\\.(\\d{2})\\.?\\s*(?:bis|-|–)\\s*(\\d{1,2})\\.(\\d{2})\\.(\\d{4})",
        "dateFrom": "$1-$2",
        "dateTo": "$3-$4-$5"
    }
]
```

### French-Speaking (FR, BE, CH)

```json
[
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
```

### Romanian

```json
[
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
```

### Nordic / English (Scandinavian countries, UK, Ireland)

These often use DD/MM or DD.MM formats. Check the specific store's date display.

### Adding Month Names

If dates include month names (e.g., "14 martie - 21 martie 2026"), the `toISODate()` function handles Romanian, French, and German month names automatically. For other languages, you may need to add month name mappings to `packages/shared/src/utils/dates.ts`.

Currently supported month names:
- **Romanian:** ianuarie, februarie, martie, ... + abbreviations (ian, feb, mar, ...)
- **French:** janvier, février, mars, avril, mai, juin, juillet, août, septembre, octobre, novembre, décembre
- **German:** Januar, Februar, März, ... + abbreviations (Mär, Mrz, Okt, Dez)

To add a new language, add entries to the `MONTH_NAMES` map in `dates.ts`:

```typescript
const MONTH_NAMES: Record<string, string> = {
  // ... existing entries ...
  // Turkish
  ocak: "01", şubat: "02", mart: "03", nisan: "04",
  mayıs: "05", haziran: "06", temmuz: "07", ağustos: "08",
  eylül: "09", ekim: "10", kasım: "11", aralık: "12",
};
```
