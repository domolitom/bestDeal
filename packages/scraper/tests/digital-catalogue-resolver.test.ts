import { describe, expect, test, mock, beforeEach } from "bun:test";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";

// Register resolver
import "../src/scraping/digital-catalogue-resolver.ts";

const SAMPLE_URL =
  "https://www.digital-catalogue.com/viewer/auchan-ro/catalog-123/";

const SAMPLE_HTML = `
<html>
<head><title>Auchan Catalog</title></head>
<body>
  <script>
    var config = {
      pagesNumber": 12,
      storageRef: "storage/s1/catalogs/auchan-ro/catalog-123/common/data/cover.jpg"
    };
  </script>
</body>
</html>
`;

describe("digital-catalogue URL detection", () => {
  test("detects digital-catalogue.com URLs", () => {
    expect(detectResolverName(SAMPLE_URL)).toBe("digital-catalogue");
  });

  test("does not match unrelated URLs", () => {
    expect(detectResolverName("https://example.com/catalog")).toBe("browser");
  });

  test("respects manual resolver override", () => {
    expect(detectResolverName(SAMPLE_URL, "browser")).toBe("browser");
  });
});

describe("digital-catalogue resolver", () => {
  beforeEach(() => {
    // @ts-ignore - mock global fetch
    globalThis.fetch = mock((_url: string, _opts?: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(SAMPLE_HTML),
      })
    );
  });

  test("resolver name and needsLastPage", async () => {
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);
    expect(resolver.name).toBe("digital-catalogue");
    expect(resolver.needsLastPage).toBe(false);
  });

  test("extracts pages from HTML with pagesNumber and storage path", async () => {
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    const result = await resolver.resolve({
      catalogId: "romania-auchan-2026-03-01-2026-03-14",
      firstPageUrl: SAMPLE_URL,
    });

    expect(result.catalogId).toBe("romania-auchan-2026-03-01-2026-03-14");
    expect(result.pages).toHaveLength(12);
    expect(result.pages[0]!.number).toBe(1);
    expect(result.pages[0]!.imageUrl).toContain("0001.webp");
    expect(result.pages[0]!.imageUrl).toContain(
      "storage/s1/catalogs/auchan-ro/catalog-123/common/data"
    );
    expect(result.pages[11]!.number).toBe(12);
    expect(result.pages[11]!.imageUrl).toContain("0012.webp");
    expect(result.coverImageUrl).toBe(result.pages[0]!.imageUrl);
  });

  test("throws on non-200 response", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve(""),
      })
    );

    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    await expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl: SAMPLE_URL,
      })
    ).rejects.toThrow("403");
  });

  test("throws when pagesNumber not found in HTML", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("<html>no useful data here</html>"),
      })
    );

    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    await expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl: SAMPLE_URL,
      })
    ).rejects.toThrow("pagesNumber");
  });

  test("throws when storage path not found in HTML", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            `<html><body>pagesNumber": 5</body></html>`
          ),
      })
    );

    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    await expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl: SAMPLE_URL,
      })
    ).rejects.toThrow("storage path");
  });
});
