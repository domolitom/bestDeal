import { describe, expect, test } from "bun:test";
import { loadStoreDefinitions } from "../src/config/store-loader.ts";

describe("loadStoreDefinitions", () => {
  test("loads all store JSON files from stores/", async () => {
    const defs = await loadStoreDefinitions();
    expect(defs.length).toBeGreaterThanOrEqual(2);

    const names = defs.map((d) => d.name);
    expect(names).toContain("lidl");
    expect(names).toContain("kaufland");
  });

  test("each definition has required fields including country", async () => {
    const defs = await loadStoreDefinitions();
    for (const def of defs) {
      expect(def.name).toBeString();
      expect(def.country).toBeString();
      expect(def.landingUrl).toBeString();
      expect(def.waitAfterLoad).toBeNumber();

      if (def.apiDiscovery) {
        expect(def.apiDiscovery.selector).toBeString();
        expect(def.apiDiscovery.idAttribute).toBeString();
        expect(def.apiDiscovery.apiUrl).toBeString();
        expect(def.apiDiscovery.fieldMap).toBeDefined();
      } else if (def.restApiDiscovery) {
        expect(def.restApiDiscovery.endpoint).toBeString();
        expect(def.restApiDiscovery.urlField).toBeString();
      } else {
        expect(def.linkPatterns.length).toBeGreaterThan(0);
        expect(["slug", "text", "slug_then_text", "leaflets_api"]).toContain(def.dateSource);
        // leaflets_api stores fetch dates from the API and don't need datePatterns
        if (def.dateSource !== "leaflets_api") {
          expect(def.datePatterns.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("country is derived from folder name", async () => {
    const defs = await loadStoreDefinitions();
    const countries = new Set(defs.map((d) => d.country));
    expect(countries).toContain("romania");
    for (const def of defs) {
      expect(def.country).toMatch(/^[a-z]+$/);
    }
  });

  test("throws for nonexistent directory", async () => {
    expect(loadStoreDefinitions("/nonexistent")).rejects.toThrow();
  });
});
