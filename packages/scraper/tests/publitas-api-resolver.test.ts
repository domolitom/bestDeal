import { describe, expect, test, mock, beforeEach } from "bun:test";
import { extractPublitasBaseUrl } from "../src/scraping/publitas-api-resolver.ts";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";

// Import to register the resolver
import "../src/scraping/publitas-api-resolver.ts";

describe("extractPublitasBaseUrl", () => {
  test("extracts base from cataloage.carrefour.ro URL", () => {
    expect(
      extractPublitasBaseUrl(
        "https://cataloage.carrefour.ro/10-hyper-mr-food-9-03-17-03-nonfood-9-03-24-03-2026/page/1"
      )
    ).toBe(
      "https://cataloage.carrefour.ro/10-hyper-mr-food-9-03-17-03-nonfood-9-03-24-03-2026"
    );
  });

  test("extracts base from view.publitas.com URL", () => {
    expect(
      extractPublitasBaseUrl(
        "https://view.publitas.com/mega-image/revista-promo-02-05-08-05-2/page/1"
      )
    ).toBe(
      "https://view.publitas.com/mega-image/revista-promo-02-05-08-05-2"
    );
  });

  test("handles page numbers > 1", () => {
    expect(
      extractPublitasBaseUrl(
        "https://cataloage.carrefour.ro/some-catalog/page/35"
      )
    ).toBe("https://cataloage.carrefour.ro/some-catalog");
  });

  test("returns null for non-Publitas URL", () => {
    expect(extractPublitasBaseUrl("https://example.com/foo")).toBeNull();
  });

  test("extracts base from embed URL with query params (Rossmann CZ iframe)", () => {
    expect(
      extractPublitasBaseUrl(
        "https://publikace.rossmann.cz/akcni-letak-25-3-7-4-2026/?publitas_embed=maximized"
      )
    ).toBe("https://publikace.rossmann.cz/akcni-letak-25-3-7-4-2026");
  });
});

describe("Publitas URL detection", () => {
  test("detects publitas.com URLs", () => {
    expect(
      detectResolverName(
        "https://view.publitas.com/mega-image/revista-promo/page/1"
      )
    ).toBe("publitas");
  });

  test("detects cataloage.carrefour.ro URLs", () => {
    expect(
      detectResolverName(
        "https://cataloage.carrefour.ro/some-catalog/page/1"
      )
    ).toBe("publitas");
  });

  test("detects publikace.rossmann.cz URLs", () => {
    expect(
      detectResolverName(
        "https://publikace.rossmann.cz/akcni-letak-25-3-7-4-2026/?publitas_embed=maximized"
      )
    ).toBe("publitas");
  });

  test("respects manual override", () => {
    expect(
      detectResolverName(
        "https://cataloage.carrefour.ro/some-catalog/page/1",
        "browser"
      )
    ).toBe("browser");
  });
});

describe("resolveViaPublitasApi", () => {
  const mockSpreads = [
    {
      pages: [
        {
          images: {
            at2400: "/1/2/pages/aaa-at2400.jpg",
            at1200: "/1/2/pages/aaa-at1200.jpg",
            at800: "/1/2/pages/aaa-at800.jpg",
          },
        },
      ],
    },
    {
      pages: [
        {
          images: {
            at2400: "/1/2/pages/bbb-at2400.jpg",
            at1200: "/1/2/pages/bbb-at1200.jpg",
            at800: "/1/2/pages/bbb-at800.jpg",
          },
        },
        {
          images: {
            at2400: "/1/2/pages/ccc-at2400.jpg",
            at1200: "/1/2/pages/ccc-at1200.jpg",
            at800: "/1/2/pages/ccc-at800.jpg",
          },
        },
      ],
    },
  ];

  beforeEach(() => {
    // @ts-ignore - mock global fetch
    globalThis.fetch = mock((url: string) => {
      if (url.includes("spreads.json")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSpreads),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });
  });

  test("resolves all pages from spreads.json", async () => {
    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://cataloage.carrefour.ro/test-catalog/page/1"
    );

    expect(resolver.name).toBe("publitas");
    expect(resolver.needsLastPage).toBe(false);

    const result = await resolver.resolve({
      catalogId: "romania-carrefour-2026-03-09-2026-03-17",
      firstPageUrl: "https://cataloage.carrefour.ro/test-catalog/page/1",
    });

    expect(result.catalogId).toBe("romania-carrefour-2026-03-09-2026-03-17");
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]!.number).toBe(1);
    expect(result.pages[0]!.imageUrl).toBe(
      "https://cataloage.carrefour.ro/1/2/pages/aaa-at1200.jpg"
    );
    expect(result.pages[1]!.number).toBe(2);
    expect(result.pages[2]!.number).toBe(3);
    expect(result.coverImageUrl).toBe(
      "https://cataloage.carrefour.ro/1/2/pages/aaa-at1200.jpg"
    );
  });

  test("returns coverThumbUrl using at400 size variant", async () => {
    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://cataloage.carrefour.ro/test-catalog/page/1"
    );
    const result = await resolver.resolve({
      catalogId: "romania-carrefour-2026-03-09-2026-03-17",
      firstPageUrl: "https://cataloage.carrefour.ro/test-catalog/page/1",
    });
    // mockSpreads first page has at400 (not present in the current mock)
    // The mock doesn't have at400/at600, so coverThumbUrl should be undefined
    expect(result.coverThumbUrl).toBeUndefined();
  });

  test("returns coverThumbUrl when at400 is available", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              pages: [
                {
                  images: {
                    at400: "/1/2/pages/aaa-at400.jpg",
                    at1200: "/1/2/pages/aaa-at1200.jpg",
                  },
                },
              ],
            },
          ]),
      })
    );

    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://cataloage.carrefour.ro/test-thumb/page/1"
    );
    const result = await resolver.resolve({
      catalogId: "romania-carrefour-2026-03-09-2026-03-17",
      firstPageUrl: "https://cataloage.carrefour.ro/test-thumb/page/1",
    });
    expect(result.coverThumbUrl).toBe(
      "https://cataloage.carrefour.ro/1/2/pages/aaa-at400.jpg"
    );
  });

  test("falls back to at600 when at400 is absent", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              pages: [
                {
                  images: {
                    at600: "/1/2/pages/aaa-at600.jpg",
                    at1200: "/1/2/pages/aaa-at1200.jpg",
                  },
                },
              ],
            },
          ]),
      })
    );

    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://cataloage.carrefour.ro/test-thumb2/page/1"
    );
    const result = await resolver.resolve({
      catalogId: "romania-carrefour-2026-03-09-2026-03-17",
      firstPageUrl: "https://cataloage.carrefour.ro/test-thumb2/page/1",
    });
    expect(result.coverThumbUrl).toBe(
      "https://cataloage.carrefour.ro/1/2/pages/aaa-at600.jpg"
    );
  });

  test("falls back to at1000 if at1200 not available", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              pages: [
                {
                  images: {
                    at1000: "/1/2/pages/xxx-at1000.jpg",
                    at800: "/1/2/pages/xxx-at800.jpg",
                  },
                },
              ],
            },
          ]),
      })
    );

    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://cataloage.carrefour.ro/test/page/1"
    );
    const result = await resolver.resolve({
      catalogId: "test",
      firstPageUrl: "https://cataloage.carrefour.ro/test/page/1",
    });

    expect(result.pages[0]!.imageUrl).toBe(
      "https://cataloage.carrefour.ro/1/2/pages/xxx-at1000.jpg"
    );
  });
});
