import { describe, expect, test, mock, beforeEach } from "bun:test";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";
import { discoverStoreViaShopfully } from "../src/discovery/discovery-engine.ts";
import type { StoreDefinition } from "@bestdeal/shared";

// Import to register the resolver
import "../src/scraping/shopfully-resolver.ts";

// --- URL detection ---

describe("Shopfully URL detection", () => {
  test("detects media-publications.shopfully.cloud PDF URLs", () => {
    expect(
      detectResolverName(
        "https://it-it-media-publications.shopfully.cloud/publications/requests/1572758_abc_2026-04-29.pdf"
      )
    ).toBe("shopfully");
  });

  test("detects shopfully.cloud/publications URLs", () => {
    expect(
      detectResolverName(
        "https://example.shopfully.cloud/publications/requests/abc.pdf"
      )
    ).toBe("shopfully");
  });

  test("respects manual override", () => {
    expect(
      detectResolverName(
        "https://it-it-media-publications.shopfully.cloud/publications/requests/1572758_abc.pdf",
        "browser"
      )
    ).toBe("browser");
  });

  test("does NOT match viewer-whitelabel.shopfully.cloud (not a PDF CDN)", () => {
    expect(
      detectResolverName(
        "https://viewer-whitelabel.shopfully.cloud/?propertyId=abc"
      )
    ).toBe("browser");
  });
});

// --- Shopfully discovery ---

const mockStoreDef: StoreDefinition = {
  name: "penny",
  country: "italy",
  landingUrl: "https://www.penny.it/sfoglia-il-volantino-mobile",
  waitAfterLoad: 0,
  linkPatterns: [],
  dateSource: "slug",
  datePatterns: [],
  resolver: "shopfully",
  shopfullyConfig: {
    propertyId: "5b50951b-b644-4f17-9904-335fac1f50fd",
    language: "it_it",
    lat: 45.468,
    lng: 9.191,
  },
};

const mockFlyersResponse = {
  status: "SUCCESS",
  data: {
    list: {
      "1572758": {
        id: "1572758",
        title: "Maxi formato",
        start_date: "2026-05-07",
        end_date: "2026-05-17",
        publication_url: "http://viewer.zmags.com/publication/it_it_86555",
        lastPubblication: {
          pdf_url:
            "https://it-it-media-publications.shopfully.cloud/publications/requests/1572758_abc_2026-04-29.pdf",
          settings: { number_of_pages: 20 },
        },
      },
      "1572726": {
        id: "1572726",
        title: "Maxi formato",
        start_date: "2026-05-07",
        end_date: "2026-05-17",
        // Same publication_url as 1572758 — should be deduplicated
        publication_url: "http://viewer.zmags.com/publication/it_it_86555",
        lastPubblication: {
          pdf_url:
            "https://it-it-media-publications.shopfully.cloud/publications/requests/1572726_abc_2026-04-29.pdf",
          settings: { number_of_pages: 20 },
        },
      },
    },
  },
};

describe("discoverStoreViaShopfully", () => {
  beforeEach(() => {
    // @ts-ignore - mock global fetch
    globalThis.fetch = mock((_url: string, _opts?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockFlyersResponse),
      })
    );
  });

  test("returns one catalog per unique publication_url (deduplication)", async () => {
    const catalogs = await discoverStoreViaShopfully(mockStoreDef);
    expect(catalogs).toHaveLength(1);
  });

  test("catalog has correct store and country", async () => {
    const catalogs = await discoverStoreViaShopfully(mockStoreDef);
    expect(catalogs[0]!.store).toBe("penny");
    expect(catalogs[0]!.country).toBe("italy");
  });

  test("catalog has correct dates from flyer", async () => {
    const catalogs = await discoverStoreViaShopfully(mockStoreDef);
    expect(catalogs[0]!.dateFrom).toBe("2026-05-07");
    expect(catalogs[0]!.dateTo).toBe("2026-05-17");
  });

  test("firstPageUrl is the PDF URL", async () => {
    const catalogs = await discoverStoreViaShopfully(mockStoreDef);
    expect(catalogs[0]!.firstPageUrl).toContain("shopfully.cloud/publications");
    expect(catalogs[0]!.firstPageUrl).toContain(".pdf");
  });

  test("returns empty array on API error", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 403, statusText: "Forbidden" })
    );
    const catalogs = await discoverStoreViaShopfully(mockStoreDef);
    expect(catalogs).toHaveLength(0);
  });

  test("returns empty array on BAD_REQUEST status", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: "BAD_REQUEST" }),
      })
    );
    const catalogs = await discoverStoreViaShopfully(mockStoreDef);
    expect(catalogs).toHaveLength(0);
  });

  test("skips flyers without pdf_url", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "SUCCESS",
            data: {
              list: {
                "999": {
                  id: "999",
                  start_date: "2026-05-07",
                  end_date: "2026-05-17",
                  publication_url: "http://viewer.zmags.com/publication/it_it_99999",
                  // No lastPubblication
                },
              },
            },
          }),
      })
    );
    const catalogs = await discoverStoreViaShopfully(mockStoreDef);
    expect(catalogs).toHaveLength(0);
  });

  test("uses correct API URL with propertyId and language", async () => {
    let capturedUrl = "";
    // @ts-ignore
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: "SUCCESS", data: { list: {} } }),
      });
    });
    await discoverStoreViaShopfully(mockStoreDef);
    expect(capturedUrl).toContain("5b50951b-b644-4f17-9904-335fac1f50fd");
    expect(capturedUrl).toContain("it_it");
    expect(capturedUrl).toContain("lat=");
    expect(capturedUrl).toContain("lng=");
  });
});

// --- Store config validation ---

describe("Penny Italy store config", () => {
  test("config file is valid JSON with required fields", async () => {
    const config = await import(
      "../stores/italy/penny.json"
    );
    const c = config.default;
    expect(c.name).toBe("penny");
    expect(c.resolver).toBe("shopfully");
    expect(c.shopfullyConfig).toBeDefined();
    expect(c.shopfullyConfig.propertyId).toBe("5b50951b-b644-4f17-9904-335fac1f50fd");
    expect(c.shopfullyConfig.language).toBe("it_it");
    expect(typeof c.shopfullyConfig.lat).toBe("number");
    expect(typeof c.shopfullyConfig.lng).toBe("number");
  });
});
