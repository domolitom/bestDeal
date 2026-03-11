import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FilesystemAdapter } from "../src/storage/fs-adapter.ts";
import type { CatalogMeta } from "@bestdeal/shared";

const TMP_DIR = join(import.meta.dir, ".tmp-test-fs-adapter");

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

describe("FilesystemAdapter (write methods)", () => {
  let adapter: FilesystemAdapter;

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
    adapter = new FilesystemAdapter(TMP_DIR);
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  test("writeCatalogMeta creates meta.json and pages dir", async () => {
    const meta = makeMeta();
    await adapter.writeCatalogMeta(meta);

    const metaPath = join(TMP_DIR, "romania", "lidl", meta.id, "meta.json");
    expect(existsSync(metaPath)).toBe(true);

    const written = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(written.id).toBe(meta.id);
    expect(written.status).toBe("ready");

    expect(existsSync(join(TMP_DIR, "romania", "lidl", meta.id, "pages"))).toBe(true);
  });

  test("writeImage writes page images to pages dir", async () => {
    const meta = makeMeta();
    await adapter.writeCatalogMeta(meta);

    const imgData = Buffer.from("fake-image-data");
    await adapter.writeImage(meta.id, "page-001.jpg", imgData);

    const imgPath = join(TMP_DIR, "romania", "lidl", meta.id, "pages", "page-001.jpg");
    expect(existsSync(imgPath)).toBe(true);
    expect(readFileSync(imgPath).toString()).toBe("fake-image-data");
  });

  test("writeImage writes cover to catalog root", async () => {
    const meta = makeMeta();
    await adapter.writeCatalogMeta(meta);

    const imgData = Buffer.from("cover-data");
    await adapter.writeImage(meta.id, "cover.jpg", imgData);

    const coverPath = join(TMP_DIR, "romania", "lidl", meta.id, "cover.jpg");
    expect(existsSync(coverPath)).toBe(true);
  });

  test("inherits read methods from FsReadAdapter", async () => {
    const meta = makeMeta();
    await adapter.writeCatalogMeta(meta);
    await adapter.writeImage(meta.id, "page-001.jpg", Buffer.from("img"));

    // Read back via inherited methods
    const catalogs = await adapter.listCatalogs();
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]!.id).toBe(meta.id);

    const catalog = await adapter.getCatalog(meta.id);
    expect(catalog).not.toBeNull();
    expect(catalog!.pages).toHaveLength(1);

    const countries = await adapter.listCountries();
    expect(countries).toHaveLength(1);

    const stores = await adapter.listStores("romania");
    expect(stores).toEqual(["lidl"]);
  });
});
