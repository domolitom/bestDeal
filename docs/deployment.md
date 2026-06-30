# Deployment Guide

This document covers how bestDeal is deployed and how to manage the production environment.

## Table of Contents

- [Overview](#overview)
- [Infrastructure](#infrastructure)
- [Cloudflare R2 (Storage)](#cloudflare-r2-storage)
  - [Bucket Configuration](#bucket-configuration)
  - [Custom Domain (CDN)](#custom-domain-cdn)
  - [API Tokens](#api-tokens)
  - [Cache Behavior](#cache-behavior)
- [Cloudflare Pages (Web App)](#cloudflare-pages-web-app)
  - [Build Configuration](#build-configuration)
  - [Environment Variables](#environment-variables)
  - [Auto-Deploy](#auto-deploy)
  - [Custom Domain](#custom-domain)
- [GitHub Actions (Scraper)](#github-actions-scraper)
  - [Secrets Setup](#secrets-setup)
  - [Schedule](#schedule)
- [Local Development](#local-development)
  - [Environment Setup](#environment-setup)
  - [Running the Web App](#running-the-web-app)
  - [Running the Scraper](#running-the-scraper)
- [Operational Procedures](#operational-procedures)
  - [Manually Triggering a Scrape](#manually-triggering-a-scrape)
  - [Manually Triggering Cleanup](#manually-triggering-cleanup)
  - [Checking What's in R2](#checking-whats-in-r2)
  - [Deleting a Specific Catalog from R2](#deleting-a-specific-catalog-from-r2)
  - [Re-Scraping a Catalog](#re-scraping-a-catalog)
  - [Adding a New Country to Production](#adding-a-new-country-to-production)

---

## Overview

```
┌─────────────────────┐
│  GitHub Repository   │
│  (master branch)     │
│                     │
│  Push triggers:     │
│  - CF Pages build   │
│  - Test workflow     │
└───────┬─────────────┘
        │
        ├──────────────────────────────────────┐
        │                                      │
        ▼                                      ▼
┌─────────────────────┐          ┌──────────────────────────┐
│  Cloudflare Pages    │          │  GitHub Actions Cron      │
│  (Web App)           │          │  (Scraper + Cleanup)      │
│                     │          │                          │
│  best-deal-shops.com│          │  Mon+Thu 6am: scrape     │
│  Edge SSR           │          │  Daily midnight: cleanup  │
└───────┬─────────────┘          └────────────┬─────────────┘
        │ reads                               │ writes
        │                                     │
        ▼                                     ▼
┌──────────────────────────────────────────────┐
│  Cloudflare R2                                │
│  Bucket: bestdeal-catalogs                    │
│  CDN: cdn.best-deal-shops.com                │
│                                              │
│  {country}/manifest.json                     │
│  {country}/{store}/{catalogId}/meta.json     │
│  {country}/{store}/{catalogId}/cover.jpg     │
│  {country}/{store}/{catalogId}/pages/*.jpg   │
└──────────────────────────────────────────────┘
```

## Infrastructure

| Component | Service | Identifier |
|-----------|---------|------------|
| Web App | Cloudflare Pages | `<pages-project>.pages.dev` |
| Domain | Cloudflare DNS | `best-deal-shops.com` |
| Storage | Cloudflare R2 | Bucket: `bestdeal-catalogs` |
| CDN | Cloudflare R2 Public Bucket | `cdn.best-deal-shops.com` |
| Scraper | GitHub Actions | Cron workflows |
| Code | GitHub | Repository on master branch |
| Cloudflare Account ID | — | `<CF_ACCOUNT_ID>` (from Cloudflare dashboard, used for `wrangler` auth — not committed) |
| Zone ID | — | `<CF_ZONE_ID>` (from Cloudflare dashboard, used for DNS/cache management — not committed) |

## Cloudflare R2 (Storage)

### Bucket Configuration

- **Bucket name:** `bestdeal-catalogs`
- **Region:** Auto (Cloudflare handles placement)
- **Public access:** Enabled via custom domain

### Custom Domain (CDN)

The R2 bucket is fronted by a custom domain: `cdn.best-deal-shops.com`

This provides:
- Cloudflare CDN caching in front of R2
- Clean URLs for image references
- Cache headers respected by the CDN

### API Tokens

R2 is accessed via S3-compatible API using API tokens. Two separate tokens are needed:
1. **Scraper token** — Read + Write access (used by GitHub Actions and local development)
2. **Pages token** — Not needed (web app reads via CDN HTTP, not S3 API)

To create/manage tokens: Cloudflare Dashboard → R2 → Manage R2 API Tokens

### Cache Behavior

| Content Type | Cache-Control | TTL |
|-------------|---------------|-----|
| `manifest.json` | `public, max-age=60` | 1 minute |
| `meta.json` | (default) | Cloudflare default |
| Page images (`.jpg`) | `public, max-age=604800, immutable` | 7 days |
| Cover images | `public, max-age=604800, immutable` | 7 days |

Page images are immutable because once a catalog is scraped, its pages never change. Manifests have short TTL because they're updated after every scrape run.

## Cloudflare Pages (Web App)

### Build Configuration

Configured in the Cloudflare Pages dashboard:

| Setting | Value |
|---------|-------|
| Production branch | `master` |
| Build command | `curl -fsSL https://bun.sh/install \| bash && ~/.bun/bin/bun install && cd packages/web && ~/.bun/bin/bun run build:cf` |
| Build output directory | `packages/web/.vercel/output/static` |
| Root directory | `/` (repo root) |

The build command installs Bun (not available on CF Pages by default), installs dependencies, and runs the Next.js build with the Cloudflare adapter.

**`wrangler.toml`** at the repo root provides additional config:
```toml
name = "bestdeal"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "packages/web/.vercel/output/static"
```

### Environment Variables

Set in Cloudflare Pages → Settings → Environment variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_CDN_URL` | `https://cdn.best-deal-shops.com` | Used by CdnReadAdapter |
| `SKIP_DEPENDENCY_INSTALL` | `true` | Prevents CF Pages from running npm install (Bun handles it) |

### Auto-Deploy

Every push to `master` triggers an automatic build and deploy on Cloudflare Pages. The deploy typically takes 2-3 minutes.

Preview deployments are created for pull requests, allowing you to verify changes before merging.

### Custom Domain

The Pages project is connected to `best-deal-shops.com` via Cloudflare DNS. Both `www` and apex domain are configured.

## GitHub Actions (Scraper)

### Secrets Setup

Go to GitHub Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret Name | Description |
|-------------|-------------|
| `R2_ENDPOINT` | `https://{accountId}.r2.cloudflarestorage.com` |
| `R2_BUCKET` | `bestdeal-catalogs` |
| `R2_ACCESS_KEY_ID` | From R2 API token |
| `R2_SECRET_ACCESS_KEY` | From R2 API token |
| `R2_PUBLIC_URL` | `https://cdn.best-deal-shops.com` |

### Schedule

See [github-actions.md](./github-actions.md) for full details on schedules, matrix strategy, and troubleshooting.

## Local Development

### Environment Setup

Create `.env.local` at the repo root:

```bash
R2_ENDPOINT=https://{accountId}.r2.cloudflarestorage.com
R2_BUCKET=bestdeal-catalogs
R2_ACCESS_KEY_ID=your-key-id
R2_SECRET_ACCESS_KEY=your-secret-key
R2_PUBLIC_URL=https://cdn.best-deal-shops.com
NEXT_PUBLIC_CDN_URL=https://cdn.best-deal-shops.com
```

This file is gitignored.

### Running the Web App

```bash
source .env.local && bun run dev
```

The dev server reads from the production CDN, so you see real catalog data locally.

### Running the Scraper

```bash
# Local filesystem (safe, no production impact)
bun run scraper -- --country=romania --store=lidl

# R2 (production! use with care)
source .env.local
bun run scraper -- --storage=r2 --country=romania --store=lidl
```

**Install Playwright first:**
```bash
cd packages/scraper && bunx playwright install chromium --with-deps
```

## Operational Procedures

### Manually Triggering a Scrape

From GitHub: Actions → "Scrape Catalogs" → "Run workflow" → select `master` → Run

Or locally:
```bash
source .env.local
bun run scraper -- --storage=r2 --country=germany
```

### Manually Triggering Cleanup

From GitHub: Actions → "Cleanup Expired Catalogs" → "Run workflow" → Run

Or locally:
```bash
source .env.local
bun run packages/scraper/src/cleanup.ts
```

### Checking What's in R2

Use the Cloudflare dashboard (R2 → bestdeal-catalogs → Browse) or the AWS CLI:

```bash
source .env.local
aws s3 ls s3://bestdeal-catalogs/ --endpoint-url $R2_ENDPOINT
aws s3 ls s3://bestdeal-catalogs/romania/ --endpoint-url $R2_ENDPOINT
```

### Deleting a Specific Catalog from R2

```bash
source .env.local
aws s3 rm s3://bestdeal-catalogs/germany/lidl/germany-lidl-2026-03-10-2026-03-16/ \
  --endpoint-url $R2_ENDPOINT --recursive
```

After deleting, regenerate the country's manifest by running the scraper for that country.

### Re-Scraping a Catalog

To force a catalog to be re-scraped:
1. Delete its objects from R2 (meta.json + all images)
2. Run the scraper for that country — discovery will find it as "new" and re-scrape it

**Important:** The `_scraping.resolver` field is set at discovery time. If you need to change the resolver, you must delete the old objects completely so the catalog is re-discovered fresh.

### Adding a New Country to Production

1. Add country metadata to `COUNTRY_META` in shared package
2. Create store config JSON files in `packages/scraper/stores/{country}/`
3. Test locally: `bun run scraper -- --discover-only --country={country}`
4. Upload to R2: `source .env.local && bun run scraper -- --storage=r2 --country={country}`
5. Verify on website: `https://best-deal-shops.com/{country}`
6. Add to GitHub Actions matrix in `scrape.yml`
7. Commit and push (triggers web app rebuild + next cron will include the country)
