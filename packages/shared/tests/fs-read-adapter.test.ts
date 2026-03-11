import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FsReadAdapter } from "../src/storage/fs-read-adapter";
import type { CatalogMeta } from "../src/types/catalog";

const TMP_DIR = join(import.meta.dir, ".tmp-test-data");

function makeMeta(overrides: Partial<CatalogMeta> = {}): CatalogMeta {
  return {
    id: "romania-lidl-2026-02-09-2026-02-15",
    store: "lidl",
    country: "romania",
    status: "ready",
    dateFrom: "2026-02-09",
    dateTo: "2026-02-15",
    coverImage: "cover.jpg",
    pageCount: 3,
    discoveredAt: "2026-02-08T10:00:00Z",
    ...overrides,
  };
}

function writeCatalog(meta: CatalogMeta, pageCount = 0) {
  const dir = join(TMP_DIR, meta.country, meta.store, meta.id);
  mkdirSync(join(dir, "pages"), { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
  for (let i = 1; i <= pageCount; i++) {
    const num = String(i).padStart(3, "0");
    writeFileSync(join(dir, "pages", `page-${num}.jpg`), `img-${i}`);
  }
}

describe("FsReadAdapter", () => {
  let adapter: FsReadAdapter;

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
    mkdirSync(TMP_DIR, { recursive: true });
    adapter = new FsReadAdapter(TMP_DIR);
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  describe("listCatalogs", () => {
    test("returns empty array for empty directory", async () => {
      expect(await adapter.listCatalogs()).toEqual([]);
    });

    test("returns empty array for non-existent directory", async () => {
      const a = new FsReadAdapter("/tmp/nonexistent-bestdeal-test");
      expect(await a.listCatalogs()).toEqual([]);
    });

    test("lists catalogs from filesystem", async () => {
      const meta = makeMeta();
      writeCatalog(meta);

      const results = await adapter.listCatalogs();
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("romania-lidl-2026-02-09-2026-02-15");
      expect(results[0].store).toBe("lidl");
      expect(results[0].country).toBe("romania");
      expect(results[0].status).toBe("ready");
    });

    test("filters by country", async () => {
      writeCatalog(makeMeta());
      writeCatalog(
        makeMeta({
          id: "germany-lidl-2026-02-09-2026-02-15",
          country: "germany",
        })
      );

      const results = await adapter.listCatalogs({ country: "romania" });
      expect(results).toHaveLength(1);
      expect(results[0].country).toBe("romania");
    });

    test("filters by store", async () => {
      writeCatalog(makeMeta());
      writeCatalog(
        makeMeta({
          id: "romania-kaufland-2026-02-09-2026-02-15",
          store: "kaufland",
        })
      );

      const results = await adapter.listCatalogs({ store: "lidl" });
      expect(results).toHaveLength(1);
      expect(results[0].store).toBe("lidl");
    });

    test("filters by status", async () => {
      writeCatalog(makeMeta({ status: "ready" }));
      writeCatalog(
        makeMeta({
          id: "romania-kaufland-2026-02-09-2026-02-15",
          store: "kaufland",
          status: "discovered",
        })
      );

      const results = await adapter.listCatalogs({ status: "ready" });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("ready");
    });

    test("sorts by dateFrom descending", async () => {
      writeCatalog(makeMeta({ dateFrom: "2026-01-01", dateTo: "2026-01-07" }));
      writeCatalog(
        makeMeta({
          id: "romania-kaufland-2026-03-01-2026-03-07",
          store: "kaufland",
          dateFrom: "2026-03-01",
          dateTo: "2026-03-07",
        })
      );

      const results = await adapter.listCatalogs();
      expect(results[0].dateFrom).toBe("2026-03-01");
      expect(results[1].dateFrom).toBe("2026-01-01");
    });

    test("skips directories without valid meta.json", async () => {
      writeCatalog(makeMeta());
      // Create a catalog dir with no meta.json
      mkdirSync(join(TMP_DIR, "romania", "lidl", "romania-lidl-2026-03-01-2026-03-07"), {
        recursive: true,
      });

      const results = await adapter.listCatalogs();
      expect(results).toHaveLength(1);
    });
  });

  describe("getCatalog", () => {
    test("returns null for invalid catalog ID", async () => {
      expect(await adapter.getCatalog("invalid")).toBeNull();
    });

    test("returns null for non-existent catalog", async () => {
      expect(
        await adapter.getCatalog("romania-lidl-2099-01-01-2099-01-07")
      ).toBeNull();
    });

    test("returns catalog with pages", async () => {
      writeCatalog(makeMeta(), 3);

      const catalog = await adapter.getCatalog(
        "romania-lidl-2026-02-09-2026-02-15"
      );
      expect(catalog).not.toBeNull();
      expect(catalog!.id).toBe("romania-lidl-2026-02-09-2026-02-15");
      expect(catalog!.pages).toHaveLength(3);
      expect(catalog!.pages[0].number).toBe(1);
      expect(catalog!.pages[0].filename).toBe("page-001.jpg");
      expect(catalog!.pages[0].imageUrl).toContain("pages/page-001.jpg");
    });

    test("returns catalog with empty pages when pages dir missing", async () => {
      writeCatalog(makeMeta(), 0);

      const catalog = await adapter.getCatalog(
        "romania-lidl-2026-02-09-2026-02-15"
      );
      expect(catalog).not.toBeNull();
      expect(catalog!.pages).toHaveLength(0);
    });
  });

  describe("getImageUrl", () => {
    test("builds correct URL", () => {
      const url = adapter.getImageUrl(
        "romania-lidl-2026-02-09-2026-02-15",
        "pages/page-001.jpg"
      );
      expect(url).toBe(
        "/data/catalogs/romania/lidl/romania-lidl-2026-02-09-2026-02-15/pages/page-001.jpg"
      );
    });

    test("returns empty string for invalid ID", () => {
      expect(adapter.getImageUrl("bad", "cover.jpg")).toBe("");
    });
  });

  describe("listCountries", () => {
    test("returns empty for empty dir", async () => {
      expect(await adapter.listCountries()).toEqual([]);
    });

    test("lists countries with store and catalog counts", async () => {
      writeCatalog(makeMeta());
      writeCatalog(
        makeMeta({
          id: "romania-kaufland-2026-02-09-2026-02-15",
          store: "kaufland",
        })
      );

      const countries = await adapter.listCountries();
      expect(countries).toHaveLength(1);
      expect(countries[0].code).toBe("romania");
      expect(countries[0].storeCount).toBe(2);
      expect(countries[0].catalogCount).toBe(2);
    });
  });

  describe("listStores", () => {
    test("returns empty for non-existent country", async () => {
      expect(await adapter.listStores("xx")).toEqual([]);
    });

    test("lists stores sorted alphabetically", async () => {
      writeCatalog(makeMeta());
      writeCatalog(
        makeMeta({
          id: "romania-kaufland-2026-02-09-2026-02-15",
          store: "kaufland",
        })
      );

      const stores = await adapter.listStores("romania");
      expect(stores).toEqual(["kaufland", "lidl"]);
    });
  });
});
