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
      expect(def.linkPatterns.length).toBeGreaterThan(0);
      expect(def.datePatterns.length).toBeGreaterThan(0);
      expect(["slug", "text", "slug_then_text"]).toContain(def.dateSource);
    }
  });

  test("country is derived from folder name", async () => {
    const defs = await loadStoreDefinitions();
    for (const def of defs) {
      expect(def.country).toBe("romania");
    }
  });

  test("throws for nonexistent directory", async () => {
    expect(loadStoreDefinitions("/nonexistent")).rejects.toThrow();
  });
});
