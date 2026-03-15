# BestDeal

A multi-country retail catalog aggregator. Scrapes weekly store catalogs (Lidl, Kaufland, Aldi, Penny, etc.) as images and serves them through a web app.

**Live at [best-deal-shops.com](https://best-deal-shops.com)**

## How It Works

```
GitHub Actions (Mon + Thu, 6am UTC)
  └─ Scraper discovers new catalogs from store websites
  └─ Downloads catalog page images
  └─ Uploads to Cloudflare R2

Cloudflare Pages (auto-deploy on push)
  └─ Next.js web app reads catalog data from R2 via CDN
  └─ Serves pages at best-deal-shops.com

Cloudflare R2 + CDN
  └─ Stores all catalog images + metadata
  └─ CDN at cdn.best-deal-shops.com serves images globally
```

## Supported Stores

| Country | Stores |
|---------|--------|
| Romania | Lidl, Kaufland, Penny, Carrefour, Auchan, Mega Image, Pepco, JYSK, Selgros, Metro, La Doi Pasi, Animax |
| Germany | Lidl, Kaufland, Aldi Sud, JYSK, Muller, Metro, Netto |
| France | Lidl |

## Repo Structure

This is a **Turborepo monorepo** with 3 packages:

```
bestDeal/
├── packages/
│   ├── shared/          TypeScript types, utilities, storage adapters
│   ├── scraper/         CLI scraping pipeline (Playwright + Bun)
│   │   └── stores/      Store configs (JSON) — one file per store
│   │       ├── romania/
│   │       ├── germany/
│   │       └── france/
│   └── web/             Next.js 15 web app (Cloudflare Pages)
├── wrangler.toml        Cloudflare Pages config
└── .github/workflows/   GitHub Actions (scraper cron + CI)
```

### packages/shared

Zero-dependency package with:
- **Types** — `CatalogMeta`, `StoreDefinition`, `Country`, storage interfaces
- **Utilities** — date parsing, catalog ID generation, URL transforms
- **Storage adapters** — `FsReadAdapter` (local), `R2ReadAdapter` (S3 API), `CdnReadAdapter` (fetch-based)

### packages/scraper

Standalone CLI that discovers and downloads catalogs:
- **Discovery engine** — loads store landing pages with Playwright, finds catalog links, extracts dates
- **Resolver registry** — platform-specific resolvers that turn a catalog URL into a list of page image URLs
- **Downloader** — fetches images and uploads to storage (filesystem or R2)
- **Pipeline** — orchestrates discovery, scraping, and manifest generation

Supported platforms (resolvers):
| Platform | Resolver | Stores |
|----------|----------|--------|
| Leaflets (Schwarz Group) | `leaflets` | Lidl, Kaufland |
| Publitas | `publitas` | Carrefour, Aldi Sud, Metro |
| iPaper | `ipaper` | JYSK |
| Yumpu | `yumpu` | Selgros |
| FlipHTML5 | `fliphtml5` | Animax |
| FlippingBook | `flippingbook` | Penny Romania |
| Digital Catalogue | `digital-catalogue` | Auchan |
| Tjek | `tjek` | Netto |
| PDF | `pdf` | Muller |
| Browser (Playwright) | `browser` | Fallback for unknown platforms |

### packages/web

Next.js 15 App Router web app deployed on Cloudflare Pages:
- Edge runtime on all routes
- Reads catalog data from R2 via CDN (`manifest.json` + individual `meta.json` files)
- Images served directly from CDN

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.3+)
- [Playwright](https://playwright.dev/) browsers: `bunx playwright install chromium`

### Install

```bash
bun install
```

### Run the scraper locally

```bash
# Scrape all countries to local filesystem
bun run scraper

# Scrape a specific country/store
bun run scraper -- --country=romania --store=lidl

# Discovery only (no downloading)
bun run scraper -- --country=germany --discover-only

# Upload to R2 (needs env vars in .env.local)
bun run scraper -- --storage=r2
```

### Run the web app locally

```bash
# With R2 data (needs .env.local with R2 credentials)
source .env.local && cd packages/web && bun run dev

# Visit http://localhost:3000
```

### Run tests

```bash
bun test packages/
```

## Adding a New Store

See [CONTRIBUTING.md](CONTRIBUTING.md) for a step-by-step guide.

The short version: create a JSON file in `packages/scraper/stores/{country}/{store}.json` and run `bun run scraper -- --country={country} --store={store} --discover-only` to test it.

## License

MIT
