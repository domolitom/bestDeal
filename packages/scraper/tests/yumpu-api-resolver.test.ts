import { describe, expect, test, mock, beforeEach } from "bun:test";
import { extractYumpuDocId } from "../src/scraping/yumpu-api-resolver.ts";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";

// Import to register the resolver
import "../src/scraping/yumpu-api-resolver.ts";

describe("extractYumpuDocId", () => {
  test("extracts ID from /document/read/ URL", () => {
    expect(
      extractYumpuDocId(
        "https://www.yumpu.com/ro/document/read/67944690/catalog-carne-selgros-2023"
      )
    ).toBe("67944690");
  });

  test("extracts ID from /document/view/ URL", () => {
    expect(
      extractYumpuDocId(
        "https://www.yumpu.com/en/document/view/12345678/some-title"
      )
    ).toBe("12345678");
  });

  test("extracts ID from /document/json/ URL", () => {
    expect(
      extractYumpuDocId("https://www.yumpu.com/ro/document/json/67944690")
    ).toBe("67944690");
  });

  test("returns null for non-Yumpu URL", () => {
    expect(extractYumpuDocId("https://example.com/foo")).toBeNull();
  });

  test("handles different language codes", () => {
    expect(
      extractYumpuDocId(
        "https://www.yumpu.com/de/document/read/99999999/title"
      )
    ).toBe("99999999");
  });
});

describe("Yumpu URL detection", () => {
  test("detects yumpu.com URLs", () => {
    expect(
      detectResolverName(
        "https://www.yumpu.com/ro/document/read/67944690/slug"
      )
    ).toBe("yumpu");
  });

  test("respects manual override", () => {
    expect(
      detectResolverName(
        "https://www.yumpu.com/ro/document/read/67944690/slug",
        "browser"
      )
    ).toBe("browser");
  });
});

describe("resolveViaYumpuApi", () => {
  const mockResponse = {
    document: {
      url_title: "catalog-carne",
      pages: [
        { nr: 1 },
        { nr: 2 },
        { nr: 3 },
      ],
    },
  };

  beforeEach(() => {
    // @ts-ignore - mock global fetch
    globalThis.fetch = mock((url: string) => {
      if (url.includes("/document/json/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
    });
  });

  test("resolves all pages from Yumpu JSON API", async () => {
    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://www.yumpu.com/ro/document/read/67944690/catalog-carne"
    );

    expect(resolver.name).toBe("yumpu");
    expect(resolver.needsLastPage).toBe(false);

    const result = await resolver.resolve({
      catalogId: "romania-selgros-2026-03-01-2026-03-15",
      firstPageUrl:
        "https://www.yumpu.com/ro/document/read/67944690/catalog-carne",
    });

    expect(result.catalogId).toBe("romania-selgros-2026-03-01-2026-03-15");
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]!.number).toBe(1);
    expect(result.pages[0]!.imageUrl).toBe(
      "https://img.yumpu.com/67944690/1/1132x1600/catalog-carne.jpg"
    );
    expect(result.pages[1]!.number).toBe(2);
    expect(result.pages[2]!.number).toBe(3);
    expect(result.coverImageUrl).toBe(result.pages[0]!.imageUrl);
  });

  test("constructs correct API URL with language", async () => {
    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://www.yumpu.com/de/document/read/67944690/test"
    );

    await resolver.resolve({
      catalogId: "test",
      firstPageUrl:
        "https://www.yumpu.com/de/document/read/67944690/test",
    });

    // @ts-ignore
    const fetchCalls = globalThis.fetch.mock.calls;
    const lastCall = fetchCalls[fetchCalls.length - 1];
    expect(lastCall[0]).toContain("/de/document/json/67944690");
  });
});
