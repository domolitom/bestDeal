import { describe, expect, test, mock, beforeEach } from "bun:test";
import { extractRossmannUuid } from "../src/scraping/rossmann-resolver.ts";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";

// Import to register the resolver
import "../src/scraping/rossmann-resolver.ts";

describe("extractRossmannUuid", () => {
  test("extracts UUID from CDN cover image URL", () => {
    expect(
      extractRossmannUuid(
        "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_1.jpg"
      )
    ).toBe("31ee9269-1a45-4323-9578-a94705d1e939");
  });

  test("extracts UUID from normal_app size URL", () => {
    expect(
      extractRossmannUuid(
        "https://pro-fra-s3-magazine.rossmann.pl/ee9d2a50-bcd5-401e-ada9-d29a86b4b9dc/normal_app/bk_1.jpg"
      )
    ).toBe("ee9d2a50-bcd5-401e-ada9-d29a86b4b9dc");
  });

  test("returns null for non-Rossmann URL", () => {
    expect(extractRossmannUuid("https://example.com/image.jpg")).toBeNull();
  });
});

describe("Rossmann URL detection", () => {
  test("detects pro-fra-s3-magazine.rossmann.pl URLs", () => {
    expect(
      detectResolverName(
        "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_1.jpg"
      )
    ).toBe("rossmann");
  });

  test("respects manual override", () => {
    expect(
      detectResolverName(
        "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_1.jpg",
        "browser"
      )
    ).toBe("browser");
  });
});

describe("resolveViaRossmann", () => {
  beforeEach(() => {
    let callCount = 0;
    // @ts-ignore - mock global fetch
    globalThis.fetch = mock((url: string, options?: RequestInit) => {
      if (!url.includes("pro-fra-s3-magazine.rossmann.pl")) {
        return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
      }

      // HEAD request — simulate 6 pages then 404
      const pageMatch = url.match(/bk_(\d+)\.jpg/);
      if (!pageMatch) {
        return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
      }
      const pageNum = parseInt(pageMatch[1]!, 10);
      return Promise.resolve({ ok: pageNum <= 6 });
    });
  });

  test("resolves all pages by probing CDN", async () => {
    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_1.jpg"
    );

    expect(resolver.name).toBe("rossmann");
    expect(resolver.needsLastPage).toBe(false);

    const result = await resolver.resolve({
      catalogId: "poland-rossmann-2026-03-26-2026-03-31",
      firstPageUrl:
        "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_1.jpg",
    });

    expect(result.catalogId).toBe("poland-rossmann-2026-03-26-2026-03-31");
    expect(result.pages).toHaveLength(6);
    expect(result.pages[0]!.number).toBe(1);
    expect(result.pages[0]!.imageUrl).toBe(
      "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_1.jpg"
    );
    expect(result.pages[5]!.number).toBe(6);
    expect(result.pages[5]!.imageUrl).toBe(
      "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_6.jpg"
    );
    expect(result.coverImageUrl).toBe(result.pages[0]!.imageUrl);
  });

  test("throws when no pages found", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() => Promise.resolve({ ok: false, status: 403 }));

    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_1.jpg"
    );

    await expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl:
          "https://pro-fra-s3-magazine.rossmann.pl/31ee9269-1a45-4323-9578-a94705d1e939/large/bk_1.jpg",
      })
    ).rejects.toThrow("Rossmann CDN returned no pages");
  });
});
