/**
 * Record RawPayload fixtures for offline discovery tests.
 *
 * Usage:
 *   bun run scripts/record-fixtures.ts                       Record the default fixture set
 *   bun run scripts/record-fixtures.ts romania/kaufland ...   Record specific store(s)
 *
 * Fixtures are written to fixtures/{country}/{store}.json as:
 *   { recordedAt, store, country, path, payload, expected }
 *
 * `payload` is the store's fetchRaw*() output (JSON-serialisable, no live
 * fetch/page objects). `expected` is parseRaw*(payload, storeDef, now) run
 * once at record time, and is what tests/fixture-discovery.test.ts asserts
 * against offline. If a retailer changes their site, re-recording will
 * change `payload` (and likely `expected`) — a visible diff in git, instead
 * of a silent `total=0` in a live scraper run.
 *
 * This script performs real network/browser I/O and must never run as part
 * of `bun test` — it's a manual/CI-maintenance tool only.
 */

// `bun test` forces TZ=UTC for determinism; pin the same TZ here so
// `expected` (computed once, at record time) matches what tests recompute
// later. Without this, @bestdeal/shared's toISODate() KW-week branch
// (`new Date(year, 0, day).toISOString()`) is local-timezone-dependent —
// recording in a non-UTC timezone would silently bake in an off-by-one-day
// fixture that fails under `bun test`'s forced UTC. This is a pre-existing
// latent bug in toISODate() itself (out of scope for this refactor, which
// only touches discovery-engine.ts/discoverer.ts/pipeline.ts/bogus-date.ts)
// — pinning TZ here just keeps record/replay consistent regardless of it.
process.env.TZ = "UTC";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "../src/browser.ts";
import { loadStoreDefinitions } from "../src/config/store-loader.ts";
import {
  fetchRawBrowserStore,
  parseRawBrowserStore,
  fetchRawViaApi,
  parseRawViaApi,
  fetchRawViaRestApi,
  parseRawViaRestApi,
  fetchRawShopfully,
  parseRawShopfully,
  fetchRawLeafletsOverview,
  parseRawLeafletsOverview,
} from "../src/discovery/discovery-engine.ts";
import type {
  DiscoveredCatalog,
  ApiDiscoveryRawPayload,
  RestApiRawPayload,
} from "../src/discovery/discovery-engine.ts";
import type { StoreDefinition } from "@bestdeal/shared";

/**
 * Some raw payloads embed a lot of retailer metadata that parseRaw*() never
 * reads (e.g. every physical store location's opening hours). Fixtures should
 * stay small and reviewable, so before writing to disk we drop fields the
 * matching parseRaw*() doesn't touch. This runs *before* `expected` is
 * computed, so the committed fixture is always internally consistent (the
 * committed payload really does parse to the committed expected output).
 */
function sanitizeApiPayload(
  payload: ApiDiscoveryRawPayload,
  storeDef: StoreDefinition
): ApiDiscoveryRawPayload {
  const fieldMap = storeDef.apiDiscovery!.fieldMap;
  const keep = new Set(Object.values(fieldMap).filter((v): v is string => !!v));
  const responses: Record<string, unknown> = {};
  for (const [id, data] of Object.entries(payload.responses)) {
    if (data == null || typeof data !== "object") {
      responses[id] = data;
      continue;
    }
    const picked: Record<string, unknown> = {};
    for (const key of keep) picked[key] = (data as Record<string, unknown>)[key];
    responses[id] = picked;
  }
  return { catalogIds: payload.catalogIds, responses };
}

function sanitizeRestApiPayload(
  payload: RestApiRawPayload,
  storeDef: StoreDefinition
): RestApiRawPayload {
  const cfg = storeDef.restApiDiscovery!;
  // Comfortably larger than the observed offset of `var catalogName = ...`
  // in blaetterkatalog viewer pages, so truncation never hides the match.
  const HTML_KEEP_CHARS = 8000;

  const root = payload.endpointJson;
  const items = cfg.arrayField
    ? ((root as Record<string, unknown> | null)?.[cfg.arrayField] as unknown[] | undefined)
    : (root as unknown[] | null);

  let endpointJson: unknown = payload.endpointJson;
  if (Array.isArray(items)) {
    // Keep only unique, non-empty urlField values — everything else in each
    // item (address, opening hours, geodata, ...) is irrelevant to parsing
    // and dedup/Set logic in extractRestApiUrls already collapses duplicates.
    const seen = new Set<string>();
    const slimItems: Record<string, string>[] = [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const val = (item as Record<string, unknown>)[cfg.urlField];
      if (typeof val !== "string" || !val.trim() || seen.has(val.trim())) continue;
      seen.add(val.trim());
      slimItems.push({ [cfg.urlField]: val });
    }
    endpointJson = cfg.arrayField ? { [cfg.arrayField]: slimItems } : slimItems;
  }

  const viewerPages: Record<string, string | null> = {};
  for (const [url, html] of Object.entries(payload.viewerPages)) {
    viewerPages[url] = html ? html.slice(0, HTML_KEEP_CHARS) : html;
  }

  return { endpointJson, viewerPages };
}

const DEFAULT_STORES = [
  "romania/kaufland",
  "romania/lidl",
  "romania/carrefour",
  "romania/pepco",
  "italy/penny", // Shopfully
  "poland/jysk", // browser path, ipaper_static_settings dateSource
  "germany/penny", // restApiDiscovery
  "italy/lidl", // leafletsOverviewConfig
];

type DiscoveryPath =
  | "browser"
  | "api"
  | "restApi"
  | "shopfully"
  | "leafletsOverview";

function detectPath(storeDef: StoreDefinition): DiscoveryPath {
  if (storeDef.shopfullyConfig) return "shopfully";
  if (storeDef.leafletsOverviewConfig) return "leafletsOverview";
  if (storeDef.restApiDiscovery) return "restApi";
  if (storeDef.apiDiscovery) return "api";
  return "browser";
}

async function recordOne(
  storeDef: StoreDefinition,
  page: import("playwright").Page
): Promise<{ path: DiscoveryPath; payload: unknown; expected: DiscoveredCatalog[] }> {
  const path = detectPath(storeDef);
  const now = new Date();

  switch (path) {
    case "shopfully": {
      const payload = await fetchRawShopfully(storeDef);
      return { path, payload, expected: parseRawShopfully(payload, storeDef, now) };
    }
    case "leafletsOverview": {
      const payload = await fetchRawLeafletsOverview(storeDef);
      return { path, payload, expected: parseRawLeafletsOverview(payload, storeDef, now) };
    }
    case "restApi": {
      const raw = await fetchRawViaRestApi(storeDef);
      const payload = sanitizeRestApiPayload(raw, storeDef);
      return { path, payload, expected: parseRawViaRestApi(payload, storeDef, now) };
    }
    case "api": {
      const raw = await fetchRawViaApi(page, storeDef);
      const payload = sanitizeApiPayload(raw, storeDef);
      return { path, payload, expected: parseRawViaApi(payload, storeDef, now) };
    }
    case "browser":
    default: {
      const payload = await fetchRawBrowserStore(page, storeDef);
      return { path, payload, expected: parseRawBrowserStore(payload, storeDef, now) };
    }
  }
}

async function main() {
  const specs = process.argv.slice(2).filter(Boolean);
  const targets = specs.length > 0 ? specs : DEFAULT_STORES;

  const allDefs = await loadStoreDefinitions();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 800, height: 1200 } });
  const page = await context.newPage();

  try {
    for (const spec of targets) {
      const [country, store] = spec.split("/");
      const storeDef = allDefs.find((d) => d.country === country && d.name === store);
      if (!storeDef) {
        console.error(`no store definition found for "${spec}" — skipping`);
        continue;
      }

      console.log(`recording fixture for ${spec}...`);
      const { path, payload, expected } = await recordOne(storeDef, page);

      const fixture = {
        recordedAt: new Date().toISOString(),
        store,
        country,
        path,
        payload,
        expected,
      };

      const outDir = join(import.meta.dir, "..", "fixtures", country!);
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, `${store}.json`);
      await writeFile(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf-8");
      console.log(`  wrote ${outPath} (path=${path}, ${expected.length} catalog(s))`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("record-fixtures failed", err);
  process.exit(1);
});
