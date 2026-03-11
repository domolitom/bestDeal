import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { FilesystemAdapter } from "../src/storage/fs-adapter.ts";
import { recoverStaleCatalogs, expireOldCatalogs } from "../src/pipeline.ts";
import type { CatalogMeta } from "@bestdeal/shared";

const TMP_DIR = join(import.meta.dir, ".tmp-test-pipeline-recovery");

function makeMeta(overrides: Partial<CatalogMeta> = {}): CatalogMeta {
  return {
    id: "romania-lidl-2026-02-09-2026-02-15",
    store: "lidl",
    country: "romania",
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

    expect(recovered).toEqual(["romania-lidl-2026-02-09-2026-02-15"]);

    const catalog = await storage.getCatalog("romania-lidl-2026-02-09-2026-02-15");
    expect(catalog!.status).toBe("discovered");
  });

  test("preserves _scraping info after recovery", async () => {
    const meta = makeMeta({ status: "scraping" });
    await storage.writeCatalogMeta(meta);

    await recoverStaleCatalogs(storage);

    const catalog = await storage.getCatalog("romania-lidl-2026-02-09-2026-02-15");
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

    const catalog = await storage.getCatalog("romania-lidl-2026-02-09-2026-02-15");
    expect(catalog!.status).toBe("discovered");
  });

  test("does not touch 'ready' catalogs", async () => {
    await storage.writeCatalogMeta(makeMeta({ status: "ready", pageCount: 5 }));

    const recovered = await recoverStaleCatalogs(storage);

    expect(recovered).toEqual([]);

    const catalog = await storage.getCatalog("romania-lidl-2026-02-09-2026-02-15");
    expect(catalog!.status).toBe("ready");
  });

  test("recovers multiple stale catalogs", async () => {
    await storage.writeCatalogMeta(
      makeMeta({
        id: "romania-lidl-2026-02-09-2026-02-15",
        status: "scraping",
      })
    );
    await storage.writeCatalogMeta(
      makeMeta({
        id: "romania-kaufland-2026-02-09-2026-02-15",
        store: "kaufland",
        status: "scraping",
      })
    );
    await storage.writeCatalogMeta(
      makeMeta({
        id: "romania-penny-2026-02-09-2026-02-15",
        store: "penny",
        status: "ready",
        pageCount: 3,
      })
    );

    const recovered = await recoverStaleCatalogs(storage);

    expect(recovered).toHaveLength(2);
    expect(recovered).toContain("romania-lidl-2026-02-09-2026-02-15");
    expect(recovered).toContain("romania-kaufland-2026-02-09-2026-02-15");

    // ready catalog untouched
    const penny = await storage.getCatalog("romania-penny-2026-02-09-2026-02-15");
    expect(penny!.status).toBe("ready");
  });

  test("returns empty array when no stale catalogs exist", async () => {
    const recovered = await recoverStaleCatalogs(storage);
    expect(recovered).toEqual([]);
  });
});

describe("expireOldCatalogs", () => {
  let storage: FilesystemAdapter;

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
    storage = new FilesystemAdapter(TMP_DIR);
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  test("expires catalogs with dateTo in the past", async () => {
    await storage.writeCatalogMeta(
      makeMeta({
        id: "romania-lidl-2020-01-01-2020-01-07",
        status: "ready",
        dateFrom: "2020-01-01",
        dateTo: "2020-01-07",
        pageCount: 5,
      })
    );

    const expired = await expireOldCatalogs(storage);

    expect(expired).toEqual(["romania-lidl-2020-01-01-2020-01-07"]);

    const catalog = await storage.getCatalog("romania-lidl-2020-01-01-2020-01-07");
    expect(catalog!.status).toBe("expired");
  });

  test("does not expire catalogs with dateTo in the future", async () => {
    await storage.writeCatalogMeta(
      makeMeta({
        id: "romania-lidl-2099-01-01-2099-01-07",
        status: "ready",
        dateFrom: "2099-01-01",
        dateTo: "2099-01-07",
        pageCount: 5,
      })
    );

    const expired = await expireOldCatalogs(storage);

    expect(expired).toEqual([]);

    const catalog = await storage.getCatalog("romania-lidl-2099-01-01-2099-01-07");
    expect(catalog!.status).toBe("ready");
  });

  test("only expires 'ready' catalogs, not other statuses", async () => {
    await storage.writeCatalogMeta(
      makeMeta({
        id: "romania-lidl-2020-01-01-2020-01-07",
        status: "discovered",
        dateFrom: "2020-01-01",
        dateTo: "2020-01-07",
      })
    );

    const expired = await expireOldCatalogs(storage);

    expect(expired).toEqual([]);

    const catalog = await storage.getCatalog("romania-lidl-2020-01-01-2020-01-07");
    expect(catalog!.status).toBe("discovered");
  });

  test("expires multiple old catalogs at once", async () => {
    await storage.writeCatalogMeta(
      makeMeta({
        id: "romania-lidl-2020-01-01-2020-01-07",
        status: "ready",
        dateFrom: "2020-01-01",
        dateTo: "2020-01-07",
        pageCount: 5,
      })
    );
    await storage.writeCatalogMeta(
      makeMeta({
        id: "romania-kaufland-2020-02-01-2020-02-07",
        store: "kaufland",
        status: "ready",
        dateFrom: "2020-02-01",
        dateTo: "2020-02-07",
        pageCount: 3,
      })
    );
    // This one is still active
    await storage.writeCatalogMeta(
      makeMeta({
        id: "romania-lidl-2099-01-01-2099-01-07",
        status: "ready",
        dateFrom: "2099-01-01",
        dateTo: "2099-01-07",
        pageCount: 5,
      })
    );

    const expired = await expireOldCatalogs(storage);

    expect(expired).toHaveLength(2);
    expect(expired).toContain("romania-lidl-2020-01-01-2020-01-07");
    expect(expired).toContain("romania-kaufland-2020-02-01-2020-02-07");

    // Active catalog untouched
    const active = await storage.getCatalog("romania-lidl-2099-01-01-2099-01-07");
    expect(active!.status).toBe("ready");
  });

  test("returns empty array when no catalogs to expire", async () => {
    const expired = await expireOldCatalogs(storage);
    expect(expired).toEqual([]);
  });
});
