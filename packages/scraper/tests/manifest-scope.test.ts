import { describe, expect, test } from "bun:test";
import { generateManifest } from "../src/pipeline.ts";
import type { StorageAdapter, CatalogFilter } from "@bestdeal/shared";

function fakeStorage() {
  const filters: (CatalogFilter | undefined)[] = [];
  const writes: { country?: string }[] = [];
  const storage = {
    listCatalogs: async (f?: CatalogFilter) => {
      filters.push(f);
      return [];
    },
    writeManifest: async (_json: string, country?: string) => {
      writes.push({ country });
    },
  } as unknown as StorageAdapter;
  return { storage, filters, writes };
}

describe("generateManifest scoping", () => {
  test("passes country filter to listCatalogs and skips root manifest", async () => {
    const { storage, filters, writes } = fakeStorage();
    await generateManifest(storage, "latvia");
    expect(filters).toEqual([{ status: "ready", country: "latvia" }]);
    expect(writes).toEqual([{ country: "latvia" }]);
  });

  test("no country lists everything and writes root manifest", async () => {
    const { storage, filters, writes } = fakeStorage();
    await generateManifest(storage);
    expect(filters).toEqual([{ status: "ready" }]);
    expect(writes).toEqual([{ country: undefined }]);
  });
});
