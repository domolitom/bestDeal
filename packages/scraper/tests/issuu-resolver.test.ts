import { describe, expect, test, mock, beforeEach } from "bun:test";
import {
  extractIssuuParts,
  extractIssuuDocId,
  extractIssuuPageCount,
} from "../src/scraping/issuu-resolver.ts";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";

// Import to register the resolver
import "../src/scraping/issuu-resolver.ts";

describe("extractIssuuParts", () => {
  test("extracts publisher and slug from standard URL", () => {
    expect(
      extractIssuuParts(
        "https://issuu.com/kpsverlag/docs/rossmann_20260315_20260321"
      )
    ).toEqual({ publisher: "kpsverlag", slug: "rossmann_20260315_20260321" });
  });

  test("returns null for non-Issuu URL", () => {
    expect(extractIssuuParts("https://example.com/foo")).toBeNull();
  });

  test("handles URLs with query strings", () => {
    expect(
      extractIssuuParts(
        "https://issuu.com/mypub/docs/my-doc?utm_source=test"
      )
    ).toEqual({ publisher: "mypub", slug: "my-doc" });
  });
});

describe("extractIssuuDocId", () => {
  test("extracts doc ID from og:image URL in HTML", () => {
    const html = `<meta property="og:image" content="https://image.isu.pub/260319130525-839276166e8c4403539572ed00bbf504/jpg/page_1_social_preview.jpg"/>`;
    expect(extractIssuuDocId(html)).toBe(
      "260319130525-839276166e8c4403539572ed00bbf504"
    );
  });

  test("extracts doc ID from JSON-escaped URL", () => {
    const html = `"imageUrl":"https:\\/\\/image.isu.pub\\/260319130525-839276166e8c4403539572ed00bbf504\\/jpg\\/page_1_thumb_large.jpg"`;
    expect(extractIssuuDocId(html)).toBe(
      "260319130525-839276166e8c4403539572ed00bbf504"
    );
  });

  test("returns null when no doc ID found", () => {
    expect(extractIssuuDocId("<html>no issuu here</html>")).toBeNull();
  });
});

describe("extractIssuuPageCount", () => {
  test("extracts pageCount from JSON-escaped content (Issuu SSR format)", () => {
    // Issuu embeds pageCount as escaped JSON in a script tag
    const html = `pageCount\\":20,\\"title\\":\\"test\\"`;
    expect(extractIssuuPageCount(html)).toBe(20);
  });

  test("extracts pageCount from unescaped JSON", () => {
    const html = `{"pageCount":32,"title":"test"}`;
    expect(extractIssuuPageCount(html)).toBe(32);
  });

  test("returns null when not found", () => {
    expect(extractIssuuPageCount("<html>nothing here</html>")).toBeNull();
  });
});

describe("Issuu URL detection", () => {
  test("detects issuu.com URLs", () => {
    expect(
      detectResolverName(
        "https://issuu.com/kpsverlag/docs/rossmann_20260315_20260321"
      )
    ).toBe("issuu");
  });

  test("respects manual override", () => {
    expect(
      detectResolverName(
        "https://issuu.com/kpsverlag/docs/rossmann_20260315_20260321",
        "browser"
      )
    ).toBe("browser");
  });
});

describe("resolveViaIssuu", () => {
  const mockHtml = `
    <meta property="og:image" content="https://image.isu.pub/260319130525-839276166e8c4403539572ed00bbf504/jpg/page_1_social_preview.jpg"/>
    "pageCount":5
  `;

  beforeEach(() => {
    // @ts-ignore - mock global fetch
    globalThis.fetch = mock((url: string) => {
      if (url.includes("issuu.com")) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(mockHtml),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
    });
  });

  test("resolves all pages from Issuu publication page", async () => {
    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://issuu.com/kpsverlag/docs/rossmann_20260315_20260321"
    );

    expect(resolver.name).toBe("issuu");
    expect(resolver.needsLastPage).toBe(false);

    const result = await resolver.resolve({
      catalogId: "germany-rossmann-2026-03-15-2026-03-21",
      firstPageUrl:
        "https://issuu.com/kpsverlag/docs/rossmann_20260315_20260321",
    });

    expect(result.catalogId).toBe("germany-rossmann-2026-03-15-2026-03-21");
    expect(result.pages).toHaveLength(5);
    expect(result.pages[0]!.number).toBe(1);
    expect(result.pages[0]!.imageUrl).toBe(
      "https://image.isu.pub/260319130525-839276166e8c4403539572ed00bbf504/jpg/page_1.jpg"
    );
    expect(result.pages[4]!.number).toBe(5);
    expect(result.pages[4]!.imageUrl).toBe(
      "https://image.isu.pub/260319130525-839276166e8c4403539572ed00bbf504/jpg/page_5.jpg"
    );
    expect(result.coverImageUrl).toBe(result.pages[0]!.imageUrl);
  });

  test("throws when publication page returns error", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 404, statusText: "Not Found" })
    );

    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://issuu.com/kpsverlag/docs/some-slug"
    );

    await expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl: "https://issuu.com/kpsverlag/docs/some-slug",
      })
    ).rejects.toThrow("HTTP 404");
  });

  test("throws when doc ID cannot be extracted", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve("<html>no image doc id here</html>"),
      })
    );

    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://issuu.com/kpsverlag/docs/some-slug"
    );

    await expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl: "https://issuu.com/kpsverlag/docs/some-slug",
      })
    ).rejects.toThrow("Could not extract Issuu image document ID");
  });
});
