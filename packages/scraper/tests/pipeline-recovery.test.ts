import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FilesystemAdapter } from "../src/storage/fs-adapter.ts";
import { recoverStaleCatalogs } from "../src/pipeline.ts";
import type { CatalogMeta } from "@bestdeal/shared";

const TMP_DIR = join(import.meta.dir, ".tmp-test-pipeline-recovery");

function makeMeta(overrides: Partial<CatalogMeta> = {}): CatalogMeta {
  return {
    id: "ro-lidl-2026-02-09-2026-02-15",
    store: "lidl",
    country: "ro",
    status: "discovered",
    dateFrom: "2026-02-09",
    dateTo: "2026-02-15",
    coverImage: "cover.jpg",
    pageCount: 0,
    discoveredAt: "2026-02-08T10:00:00Z",
    _scraping: {
      resolver: "browser",
      firstPageUrl: "https://example.com/page/1",
      lastPage: 10,
    },
    ...overrides,
  };
}

describe("recoverStaleCatalogs", () => {
  let storage: FilesystemAdapter;

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
    storage = new FilesystemAdapter(TMP_DIR);
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  test("resets 'scraping' catalogs to 'discovered'", async () => {
    await storage.writeCatalogMeta(makeMeta({ status: "scraping" }));

    const recovered = await recoverStaleCatalogs(storage);

    expect(recovered).toEqual(["ro-lidl-2026-02-09-2026-02-15"]);

    const catalog = await storage.getCatalog("ro-lidl-2026-02-09-2026-02-15");
    expect(catalog!.status).toBe("discovered");
  });

  test("preserves _scraping info after recovery", async () => {
    const meta = makeMeta({ status: "scraping" });
    await storage.writeCatalogMeta(meta);

    await recoverStaleCatalogs(storage);

    const catalog = await storage.getCatalog("ro-lidl-2026-02-09-2026-02-15");
    expect(catalog!._scraping).toEqual({
      resolver: "browser",
      firstPageUrl: "https://example.com/page/1",
      lastPage: 10,
    });
  });

  test("does not touch 'discovered' catalogs", async () => {
    await storage.writeCatalogMeta(makeMeta({ status: "discovered" }));

    const recovered = await recoverStaleCatalogs(storage);

    expect(recovered).toEqual([]);

    const catalog = await storage.getCatalog("ro-lidl-2026-02-09-2026-02-15");
    expect(catalog!.status).toBe("discovered");
  });

  test("does not touch 'ready' catalogs", async () => {
    await storage.writeCatalogMeta(makeMeta({ status: "ready", pageCount: 5 }));

    const recovered = await recoverStaleCatalogs(storage);

    expect(recovered).toEqual([]);

    const catalog = await storage.getCatalog("ro-lidl-2026-02-09-2026-02-15");
    expect(catalog!.status).toBe("ready");
  });

  test("recovers multiple stale catalogs", async () => {
    await storage.writeCatalogMeta(
      makeMeta({
        id: "ro-lidl-2026-02-09-2026-02-15",
        status: "scraping",
      })
    );
    await storage.writeCatalogMeta(
      makeMeta({
        id: "ro-kaufland-2026-02-09-2026-02-15",
        store: "kaufland",
        status: "scraping",
      })
    );
    await storage.writeCatalogMeta(
      makeMeta({
        id: "ro-penny-2026-02-09-2026-02-15",
        store: "penny",
        status: "ready",
        pageCount: 3,
      })
    );

    const recovered = await recoverStaleCatalogs(storage);

    expect(recovered).toHaveLength(2);
    expect(recovered).toContain("ro-lidl-2026-02-09-2026-02-15");
    expect(recovered).toContain("ro-kaufland-2026-02-09-2026-02-15");

    // ready catalog untouched
    const penny = await storage.getCatalog("ro-penny-2026-02-09-2026-02-15");
    expect(penny!.status).toBe("ready");
  });

  test("returns empty array when no stale catalogs exist", async () => {
    const recovered = await recoverStaleCatalogs(storage);
    expect(recovered).toEqual([]);
  });
});
