import { describe, expect, test, mock, beforeEach } from "bun:test";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";
import {
  parseBlaetterkatalogUrl,
  buildApiBase,
  fetchPageCount,
} from "../src/scraping/blaetterkatalog-resolver.ts";

// Ensure resolver is registered
import "../src/scraping/blaetterkatalog-resolver.ts";

const SAMPLE_URL =
  "https://penny-publish.blaetterkatalog.de/frontend/getcatalog.do?catalogId=1293977";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?><catalog name="PENNY-HZ-KW20-15A-08-26" nofpages="38"><structure/><mapping><range id_start="1" nr_start="1" pages="38"/></mapping></catalog>`;

// --- URL detection ---

describe("blaetterkatalog URL detection", () => {
  test("detects blaetterkatalog.de viewer URLs", () => {
    expect(detectResolverName(SAMPLE_URL)).toBe("blaetterkatalog");
  });

  test("does not match unrelated URLs", () => {
    expect(detectResolverName("https://example.com/catalog")).toBe("browser");
  });

  test("respects manual resolver override", () => {
    expect(detectResolverName(SAMPLE_URL, "browser")).toBe("browser");
  });
});

// --- parseBlaetterkatalogUrl ---

describe("parseBlaetterkatalogUrl", () => {
  test("extracts catalogId and default version 1", () => {
    const result = parseBlaetterkatalogUrl(SAMPLE_URL);
    expect(result).not.toBeNull();
    expect(result!.catalogId).toBe("1293977");
    expect(result!.catalogVersion).toBe("1");
    expect(result!.origin).toBe("https://penny-publish.blaetterkatalog.de");
  });

  test("extracts explicit catalogVersion from URL", () => {
    const url =
      "https://penny-publish.blaetterkatalog.de/frontend/getcatalog.do?catalogId=9876&catalogVersion=2";
    const result = parseBlaetterkatalogUrl(url);
    expect(result).not.toBeNull();
    expect(result!.catalogId).toBe("9876");
    expect(result!.catalogVersion).toBe("2");
  });

  test("returns null when catalogId is missing", () => {
    expect(
      parseBlaetterkatalogUrl(
        "https://penny-publish.blaetterkatalog.de/frontend/getcatalog.do"
      )
    ).toBeNull();
  });

  test("returns null for an unparseable URL", () => {
    expect(parseBlaetterkatalogUrl("not-a-url")).toBeNull();
  });
});

// --- buildApiBase ---

describe("buildApiBase", () => {
  test("builds correct API base URL", () => {
    const base = buildApiBase(
      "https://penny-publish.blaetterkatalog.de",
      "1293977",
      "1"
    );
    expect(base).toBe(
      "https://penny-publish.blaetterkatalog.de/frontend/mvc/api/catalogs/1293977/v1"
    );
  });

  test("handles version 2", () => {
    const base = buildApiBase("https://example.blaetterkatalog.de", "999", "2");
    expect(base).toBe(
      "https://example.blaetterkatalog.de/frontend/mvc/api/catalogs/999/v2"
    );
  });
});

// --- fetchPageCount ---

describe("fetchPageCount", () => {
  beforeEach(() => {
    // @ts-ignore
    globalThis.fetch = mock((_url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(SAMPLE_XML),
      })
    );
  });

  test("parses nofpages from catalog.xml", async () => {
    const count = await fetchPageCount(
      "https://penny-publish.blaetterkatalog.de/frontend/mvc/api/catalogs/1293977/v1"
    );
    expect(count).toBe(38);
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

    await expect(fetchPageCount("https://example.com/api")).rejects.toThrow("403");
  });

  test("throws when nofpages attribute is missing", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(`<?xml version="1.0"?><catalog name="test"><structure/></catalog>`),
      })
    );

    await expect(fetchPageCount("https://example.com/api")).rejects.toThrow(
      "nofpages"
    );
  });
});

// --- Full resolver ---

describe("blaetterkatalog resolver", () => {
  beforeEach(() => {
    // @ts-ignore
    globalThis.fetch = mock((_url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(SAMPLE_XML),
      })
    );
  });

  test("resolver name and needsLastPage", async () => {
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);
    expect(resolver.name).toBe("blaetterkatalog");
    expect(resolver.needsLastPage).toBe(false);
  });

  test("resolves 38 pages with correct image URLs", async () => {
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    const result = await resolver.resolve({
      catalogId: "germany-penny-2026-05-11-2026-05-16",
      firstPageUrl: SAMPLE_URL,
    });

    expect(result.catalogId).toBe("germany-penny-2026-05-11-2026-05-16");
    expect(result.pages).toHaveLength(38);

    expect(result.pages[0]!.number).toBe(1);
    expect(result.pages[0]!.imageUrl).toBe(
      "https://penny-publish.blaetterkatalog.de/frontend/mvc/api/catalogs/1293977/v1/normal/bk_1.jpg"
    );

    expect(result.pages[37]!.number).toBe(38);
    expect(result.pages[37]!.imageUrl).toBe(
      "https://penny-publish.blaetterkatalog.de/frontend/mvc/api/catalogs/1293977/v1/normal/bk_38.jpg"
    );
  });

  test("cover image URL uses getwebdata.do pattern", async () => {
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    const result = await resolver.resolve({
      catalogId: "test",
      firstPageUrl: SAMPLE_URL,
    });

    expect(result.coverImageUrl).toContain(
      "penny-publish.blaetterkatalog.de/frontend/getwebdata.do"
    );
    expect(result.coverImageUrl).toContain("catcover.jpg");
    expect(result.coverImageUrl).toContain("catalogid=1293977");
  });

  test("handles catalogVersion=2 in URL", async () => {
    const urlV2 =
      "https://penny-publish.blaetterkatalog.de/frontend/getcatalog.do?catalogId=9999&catalogVersion=2";
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(urlV2);

    const result = await resolver.resolve({
      catalogId: "test",
      firstPageUrl: urlV2,
    });

    expect(result.pages[0]!.imageUrl).toContain("/v2/normal/bk_1.jpg");
    expect(result.pages[0]!.imageUrl).toContain("catalogs/9999");
  });

  test("throws when URL has no catalogId", async () => {
    const badUrl =
      "https://penny-publish.blaetterkatalog.de/frontend/getcatalog.do";
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    // URL matches blaetterkatalog detection rule, so this resolver is selected
    const resolver = getResolver(badUrl);

    await expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl: badUrl,
      })
    ).rejects.toThrow("catalogId");
  });
});
