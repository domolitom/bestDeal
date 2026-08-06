/**
 * Offline discovery fixture replay.
 *
 * Each fixture under fixtures/{country}/{store}.json holds a RawPayload
 * recorded live (via `bun run record-fixtures`) plus the `expected`
 * DiscoveredCatalog[] computed from it at record time. This suite re-runs
 * the matching PURE parseRaw*() function against the frozen payload with a
 * fixed clock and asserts the output hasn't drifted — with no network
 * access at all (global.fetch is stubbed to throw).
 *
 * If a retailer changes their site, `bun run record-fixtures` will produce
 * a new payload/expected pair with a visible git diff — including the
 * "total=0" case (see fixtures/romania/pepco.json) — instead of a silent
 * zero buried in a scraper log.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StoreDefinition } from "@bestdeal/shared";
import { loadStoreDefinitions } from "../src/config/store-loader.ts";
import {
  parseRawBrowserStore,
  parseRawViaApi,
  parseRawViaRestApi,
  parseRawShopfully,
  parseRawLeafletsOverview,
} from "../src/discovery/discovery-engine.ts";
import type {
  DiscoveredCatalog,
  BrowserRawPayload,
  ApiDiscoveryRawPayload,
  RestApiRawPayload,
  ShopfullyRawPayload,
  LeafletsOverviewRawPayload,
} from "../src/discovery/discovery-engine.ts";

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures");
const FIXED_NOW = new Date("2026-08-06T06:00:00.000Z");

interface Fixture {
  recordedAt: string;
  store: string;
  country: string;
  path: "browser" | "api" | "restApi" | "shopfully" | "leafletsOverview";
  payload: unknown;
  expected: DiscoveredCatalog[];
}

async function findFixtureFiles(): Promise<string[]> {
  const countries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  const files: string[] = [];
  for (const c of countries) {
    if (!c.isDirectory()) continue;
    const dir = join(FIXTURES_DIR, c.name);
    for (const f of await readdir(dir)) {
      if (f.endsWith(".json")) files.push(join(dir, f));
    }
  }
  return files.sort();
}

function parseFixture(fixture: Fixture, storeDef: StoreDefinition): DiscoveredCatalog[] {
  switch (fixture.path) {
    case "browser":
      return parseRawBrowserStore(fixture.payload as BrowserRawPayload, storeDef, FIXED_NOW);
    case "api":
      return parseRawViaApi(fixture.payload as ApiDiscoveryRawPayload, storeDef, FIXED_NOW);
    case "restApi":
      return parseRawViaRestApi(fixture.payload as RestApiRawPayload, storeDef, FIXED_NOW);
    case "shopfully":
      return parseRawShopfully(fixture.payload as ShopfullyRawPayload, storeDef, FIXED_NOW);
    case "leafletsOverview":
      return parseRawLeafletsOverview(
        fixture.payload as LeafletsOverviewRawPayload,
        storeDef,
        FIXED_NOW
      );
  }
}

describe("fixture-driven discovery replay (offline, no network)", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Any network call during parseRaw*() would indicate an impurity leak —
    // fail loudly instead of silently hitting the network in CI.
    // @ts-ignore
    globalThis.fetch = () => {
      throw new Error(
        "parseRaw*() must not call fetch() — purity violation in fixture replay"
      );
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("at least one fixture file exists", async () => {
    const files = await findFixtureFiles();
    expect(files.length).toBeGreaterThan(0);
  });

  test("every discovery path (browser, api, restApi, shopfully, leafletsOverview) has fixture coverage", async () => {
    const files = await findFixtureFiles();
    const paths = new Set<string>();
    for (const file of files) {
      const fixture: Fixture = JSON.parse(await readFile(file, "utf-8"));
      paths.add(fixture.path);
    }
    expect([...paths].sort()).toEqual(
      ["api", "browser", "leafletsOverview", "restApi", "shopfully"].sort()
    );
  });

  test("romania/pepco fixture documents the known zero-result case", async () => {
    const path = join(FIXTURES_DIR, "romania", "pepco.json");
    const fixture: Fixture = JSON.parse(await readFile(path, "utf-8"));
    expect(fixture.expected).toEqual([]);
  });
});

// Dynamically generate one test per fixture file so failures point at the
// specific store/path that regressed.
const fixtureFiles = await findFixtureFiles();
const storeDefs = await loadStoreDefinitions();

for (const file of fixtureFiles) {
  const relPath = file.replace(FIXTURES_DIR + "/", "");

  describe(`fixture: ${relPath}`, () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      // @ts-ignore
      globalThis.fetch = () => {
        throw new Error(
          `parseRaw*() must not call fetch() — purity violation replaying ${relPath}`
        );
      };
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test(`parses to the recorded expected output`, async () => {
      const fixture: Fixture = JSON.parse(await readFile(file, "utf-8"));
      const storeDef = storeDefs.find(
        (d) => d.country === fixture.country && d.name === fixture.store
      );
      expect(storeDef).toBeDefined();

      const actual = parseFixture(fixture, storeDef!);
      expect(actual).toEqual(fixture.expected);
    });
  });
}
