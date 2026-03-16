# bestDeal Documentation

Comprehensive documentation for the bestDeal retail catalog aggregator.

## Documents

| Document | Description |
|----------|-------------|
| [Architecture Overview](./architecture.md) | System design, monorepo structure, data flow, storage architecture, key design decisions |
| [Scraper Pipeline](./scraper-pipeline.md) | CLI usage, pipeline phases, store config schema, discovery engine, all resolver details |
| [Resolvers](./resolvers.md) | What resolvers are, how they work, reference for all 10 resolvers, how to write a new one |
| [Web Application](./web-app.md) | Next.js app structure, routes, data loading, edge runtime, components |
| [Adding a Store](./adding-a-store.md) | Step-by-step guide to add a new store, config field reference, real-world examples |
| [Adding a Country](./adding-a-country.md) | How to add a new country, date format templates, multi-country store tips |
| [GitHub Actions](./github-actions.md) | Scraping cron, cleanup job, test workflow, secrets, monitoring |
| [Deployment](./deployment.md) | Infrastructure overview, Cloudflare R2/Pages config, local dev setup, operational procedures |

## Quick Links

- **Live site:** https://best-deal-shops.com
- **CDN:** https://cdn.best-deal-shops.com
- **Store configs:** `packages/scraper/stores/{country}/{store}.json`
- **Scraper entry:** `packages/scraper/src/cli.ts`
- **Web app entry:** `packages/web/src/app/page.tsx`
