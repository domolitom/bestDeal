import { describe, expect, test, mock, beforeEach } from "bun:test";
import {
  extractFlyerSlug,
  deriveLeafletsApiHost,
} from "../src/scraping/leaflets-api-resolver.ts";

describe("extractFlyerSlug", () => {
  test("extracts slug from /view/flyer/page/ URL", () => {
    expect(
      extractFlyerSlug(
        "https://leaflets.schwarz/du-26-02-au-04-03-les-promos-de-la-semaine/view/flyer/page/1"
      )
    ).toBe("du-26-02-au-04-03-les-promos-de-la-semaine");
  });

  test("extracts slug from /ar/ URL", () => {
    expect(
      extractFlyerSlug(
        "https://leaflets.lidl.ro/lidl-promotii-5-mar-11-mar-2026/ar/1"
      )
    ).toBe("lidl-promotii-5-mar-11-mar-2026");
  });

  test("returns null for non-leaflets URL", () => {
    expect(extractFlyerSlug("https://example.com/foo")).toBeNull();
  });
});

describe("deriveLeafletsApiHost", () => {
  test("derives schwarz host from leaflets.schwarz URL", () => {
    expect(
      deriveLeafletsApiHost("https://leaflets.schwarz/some-slug/ar/1")
    ).toBe("endpoints.leaflets.schwarz");
  });

  test("derives kaufland host from leaflets.kaufland.com URL", () => {
    expect(
      deriveLeafletsApiHost(
        "https://leaflets.kaufland.com/some-slug/view/flyer/page/1"
      )
    ).toBe("endpoints.leaflets.kaufland.com");
  });

  test("falls back to schwarz host when no leaflets domain", () => {
    expect(deriveLeafletsApiHost("https://example.com/foo")).toBe(
      "endpoints.leaflets.schwarz"
    );
  });
});

describe("resolveViaLeafletsApi", () => {
  const mockFlyer = {
    pages: [
      { number: 1, image: "https://img.example.com/page1.jpg", thumbnail: "https://img.example.com/thumb1.jpg" },
      { number: 2, image: "https://img.example.com/page2.jpg", thumbnail: "https://img.example.com/thumb2.jpg" },
      { number: 3, image: "https://img.example.com/page3.jpg", thumbnail: "https://img.example.com/thumb3.jpg" },
    ],
    thumbnailUrl: "https://img.example.com/flyer-thumb.jpg",
  };

  beforeEach(() => {
    // @ts-ignore - mock global fetch
    globalThis.fetch = mock((url: string) => {
      if (url.includes("/v4/flyer")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ flyer: mockFlyer }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });
  });

  test("resolves pages from leaflets API", async () => {
    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://leaflets.schwarz/some-slug/ar/1"
    );

    expect(resolver.name).toBe("leaflets");

    const result = await resolver.resolve({
      catalogId: "romania-lidl-2026-03-20-2026-03-26",
      firstPageUrl: "https://leaflets.schwarz/some-slug/ar/1",
    });

    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]!.imageUrl).toBe("https://img.example.com/page1.jpg");
    expect(result.coverImageUrl).toBe("https://img.example.com/page1.jpg");
  });

  test("populates coverThumbUrl from first page thumbnail", async () => {
    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://leaflets.schwarz/some-slug/ar/1"
    );
    const result = await resolver.resolve({
      catalogId: "romania-lidl-2026-03-20-2026-03-26",
      firstPageUrl: "https://leaflets.schwarz/some-slug/ar/1",
    });

    expect(result.coverThumbUrl).toBe("https://img.example.com/thumb1.jpg");
  });

  test("falls back to flyer-level thumbnailUrl when page thumbnail is absent", async () => {
    // @ts-ignore
    globalThis.fetch = mock((url: string) => {
      if (url.includes("/v4/flyer")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              flyer: {
                pages: [
                  { number: 1, image: "https://img.example.com/page1.jpg", thumbnail: "" },
                ],
                thumbnailUrl: "https://img.example.com/flyer-thumb.jpg",
              },
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://leaflets.schwarz/slug-no-page-thumb/ar/1"
    );
    const result = await resolver.resolve({
      catalogId: "romania-lidl-2026-03-20-2026-03-26",
      firstPageUrl: "https://leaflets.schwarz/slug-no-page-thumb/ar/1",
    });

    expect(result.coverThumbUrl).toBe("https://img.example.com/flyer-thumb.jpg");
  });

  test("throws when API returns no pages", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ flyer: { pages: [], thumbnailUrl: "" } }),
      })
    );

    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://leaflets.schwarz/empty-slug/ar/1"
    );

    await expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl: "https://leaflets.schwarz/empty-slug/ar/1",
      })
    ).rejects.toThrow();
  });
});
