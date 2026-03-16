# GitHub Actions Workflows

This document describes the GitHub Actions workflows that automate scraping, cleanup, and testing.

## Table of Contents

- [Overview](#overview)
- [Scraping Workflow](#scraping-workflow)
  - [Schedule](#schedule)
  - [Matrix Strategy](#matrix-strategy)
  - [Steps](#steps)
  - [Environment Variables](#environment-variables)
  - [Adding a New Country](#adding-a-new-country)
  - [Manual Triggering](#manual-triggering)
  - [Timeouts and Failures](#timeouts-and-failures)
- [Cleanup Workflow](#cleanup-workflow)
  - [What Gets Cleaned Up](#what-gets-cleaned-up)
  - [Manifest Regeneration](#manifest-regeneration)
- [Test Workflow](#test-workflow)
- [Secrets Management](#secrets-management)
- [Monitoring and Debugging](#monitoring-and-debugging)

---

## Overview

bestDeal has three GitHub Actions workflows:

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Scrape Catalogs | `scrape.yml` | Mon+Thu 6am UTC + manual | Discover and scrape new catalogs, upload to R2 |
| Cleanup Expired | `cleanup.yml` | Daily midnight UTC + manual | Delete expired/failed catalogs from R2 |
| Tests | `test.yml` | On push/PR | Run unit tests |

## Scraping Workflow

**File:** `.github/workflows/scrape.yml`

This is the main production workflow that keeps the catalog data fresh.

### Schedule

```yaml
on:
  schedule:
    - cron: "0 6 * * 1"   # Monday at 6am UTC
    - cron: "0 6 * * 4"   # Thursday at 6am UTC
  workflow_dispatch: {}     # Manual trigger
```

**Why Monday and Thursday?** Most European retail catalogs have a weekly cycle:
- German stores typically refresh on Monday
- Romanian stores typically refresh on Thursday
- Running twice a week catches both cycles with minimal resource usage

**Why 6am UTC?** Catalogs are usually published early morning local time. 6am UTC is 8am CET / 9am EET, which is after most stores publish their new catalogs but early enough that users see fresh data during the day.

### Matrix Strategy

```yaml
strategy:
  fail-fast: false
  matrix:
    country: [romania, germany, france]
```

Each country runs as a **separate parallel job**. This provides:
- **Isolation:** A failure in one country doesn't block others
- **Parallelism:** All countries scrape simultaneously
- **Timeouts:** Each country has its own 30-minute timeout

`fail-fast: false` is critical — without it, a single country failure would cancel all other running jobs.

### Steps

Each matrix job runs these steps:

1. **Checkout** — Clone the repository
2. **Setup Bun** — Install the latest Bun runtime
3. **Install dependencies** — `bun install --frozen-lockfile`
4. **Install Playwright** — `cd packages/scraper && bunx playwright install chromium --with-deps`
5. **Run scraper** — `bun run scraper -- --storage=r2 --country=${{ matrix.country }}`

The scraper command runs the full pipeline:
- Recovers stale catalogs from previous crashed runs
- Expires old catalogs past their dateTo
- Discovers new catalogs from all stores in the country
- Scrapes new catalogs (resolves pages, downloads images, uploads to R2)
- Generates the country's manifest.json

### Environment Variables

All R2 credentials are passed from GitHub Secrets:

```yaml
env:
  R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
  R2_BUCKET: ${{ secrets.R2_BUCKET }}
  R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
  R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
  R2_PUBLIC_URL: ${{ secrets.R2_PUBLIC_URL }}
```

### Adding a New Country

To add a new country to automatic scraping:

1. Ensure store configs exist in `packages/scraper/stores/{country}/`
2. Add country metadata to `COUNTRY_META` in shared package
3. Edit `.github/workflows/scrape.yml` and add the country to the matrix:

```yaml
matrix:
  country: [romania, germany, france, poland]  # Added poland
```

4. Commit and push. The next scheduled run (or manual trigger) will include the new country.

### Manual Triggering

You can trigger the scraping workflow manually from the GitHub Actions UI:

1. Go to Actions → "Scrape Catalogs"
2. Click "Run workflow"
3. Select the branch (usually `master`)
4. Click "Run workflow"

This triggers all matrix jobs. If you only want to scrape one country, you currently need to modify the matrix temporarily or use the CLI directly.

### Timeouts and Failures

- **Job timeout:** 30 minutes per country
- **Common timeout causes:**
  - Browser resolver is too slow (5+ seconds per page × 60+ pages)
  - Store website is unresponsive or rate-limiting
  - Too many stores in a single country
- **On failure:** The failed catalog is marked as `"failed"` in R2. Other catalogs and other countries continue normally.
- **On timeout:** GitHub kills the job. Catalogs stuck in `"scraping"` status are recovered on the next run (Phase 0 housekeeping).

## Cleanup Workflow

**File:** `.github/workflows/cleanup.yml`

```yaml
on:
  schedule:
    - cron: "0 0 * * *"   # Daily at midnight UTC
  workflow_dispatch: {}
```

### What Gets Cleaned Up

The cleanup job deletes catalogs with two statuses:

1. **`expired`** — Catalogs whose `dateTo` has passed. These were marked as expired by the scraper pipeline's housekeeping phase. Deleting them frees R2 storage and keeps the CDN clean.

2. **`failed`** — Catalogs that failed during scraping (resolver errors, download failures, etc.). These have no usable page images and should not persist.

For each catalog, **all R2 objects** are deleted:
- `meta.json`
- `cover.jpg`
- `pages/page-001.jpg`, `pages/page-002.jpg`, etc.

### Manifest Regeneration

After deleting catalogs, the cleanup job regenerates manifests for all affected countries. This ensures the web app stops showing deleted catalogs within the CDN cache TTL (1 minute for manifests).

```typescript
const affectedCountries = new Set(toDelete.map((c) => c.country));
for (const country of affectedCountries) {
  await generateManifest(storage, country);
}
```

## Test Workflow

**File:** `.github/workflows/test.yml`

Runs the test suite on push and pull requests. Uses `bun test` to run all tests across all packages.

The project has 135+ tests across 14 files covering:
- Date parsing and ISO conversion
- Catalog ID building and parsing
- URL transforms
- Resolver-specific logic (Publitas base URL extraction, Yumpu doc ID extraction, etc.)
- Store config validation

## Secrets Management

All secrets are stored in GitHub repository settings (Settings → Secrets and variables → Actions):

| Secret | Description |
|--------|-------------|
| `R2_ENDPOINT` | Cloudflare R2 S3-compatible endpoint |
| `R2_BUCKET` | R2 bucket name (`bestdeal-catalogs`) |
| `R2_ACCESS_KEY_ID` | R2 API token key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_PUBLIC_URL` | Public CDN URL for the bucket |

The same secrets are also set in:
- **Cloudflare Pages** (for the web app build): via Cloudflare dashboard or `wrangler pages secret put`
- **Local development**: in `.env.local` (gitignored)

### Rotating Credentials

To rotate R2 API tokens:
1. Create a new API token in the Cloudflare dashboard (R2 → Manage R2 API Tokens)
2. Update `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in GitHub Secrets
3. Update the same values in Cloudflare Pages secrets (if the web app uses them)
4. Update `.env.local` for local development
5. The old token can be revoked after verifying the new one works

## Monitoring and Debugging

### Checking Workflow Status

- Go to the GitHub Actions tab to see all workflow runs
- Each matrix job shows its own structured logs. In CI (`CI=true`), logs are JSON lines with `level`, `msg`, `module`, `catalogId`, and timing fields. Locally, the same logs appear as human-readable `[module] message` format.
- The pipeline summary at the end of each run shows total scraped/failed counts with duration

### Common Issues

**"Install Playwright" step is slow:**
Playwright downloads Chromium (~130MB) on every run because GitHub Actions runners are ephemeral. This typically takes 30-60 seconds. Caching could help but isn't currently configured.

**Timeout on a specific country:**
If a country consistently times out, consider:
- Increasing the `timeout-minutes` in the workflow
- Moving slow stores to a separate job
- Replacing slow browser resolver calls with API-based resolvers

**Scraper finds 0 new catalogs:**
This is normal if all current catalogs were already discovered in a previous run. Check the `existing` count in the discovery report.

**All catalogs fail for a store:**
The store website may have changed its structure. Check:
- Is the landing URL still correct?
- Have the link patterns changed?
- Has the platform changed?
- Is there new bot detection?

### Re-Running a Failed Job

1. Go to Actions → find the failed run
2. Click "Re-run failed jobs" to retry only the failed matrix jobs
3. Or click "Re-run all jobs" to re-run everything

### Running the Scraper Locally for Debugging

```bash
# Source R2 credentials
source .env.local

# Run for a specific store with R2 to see exactly what happens
bun run scraper -- --storage=r2 --country=germany --store=lidl

# Discovery only (faster, no image downloads)
bun run scraper -- --discover-only --country=germany --store=lidl
```

The scraper outputs detailed logs for every step, making it easy to identify where things go wrong.
