import { describe, expect, test, mock, beforeEach } from "bun:test";
import {
  parseDates,
  applyUrlTransforms,
  extractCatalogType,
} from "@bestdeal/shared";
import type {
  DatePattern,
  CatalogTypePattern,
  UrlTransform,
  StoreDefinition,
} from "@bestdeal/shared";
import {
  fetchLeafletsApiDates,
  discoverStoreViaLeafletsOverview,
} from "../src/discovery/discovery-engine.ts";

// --- parseDates ---

const lidlDatePatterns: DatePattern[] = [
  {
    match: "(\\d{2}-\\d{2})-(\\d{2}-\\d{2}-\\d{4})$",
    dateFrom: "$1",
    dateTo: "$2",
  },
  {
    match: "(\\d{2})\\.(\\d{2})\\s*-\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})",
    dateFrom: "$1-$2",
    dateTo: "$3-$4-$5",
  },
];

const kauflandDatePatterns: DatePattern[] = [
  {
    match:
      "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s*-\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})",
    dateFrom: "$1-$2",
    dateTo: "$4-$5-$6",
  },
];

describe("parseDates", () => {
  test("Lidl slug format", () => {
    expect(
      parseDates(
        "catalogul-saptamanal-pentru-perioada-09-02-15-02-2026",
        lidlDatePatterns
      )
    ).toEqual({ dateFrom: "09-02", dateTo: "15-02-2026" });
  });

  test("Lidl slug different range", () => {
    expect(
      parseDates(
        "catalogul-saptamanal-pentru-perioada-23-01-29-01-2026",
        lidlDatePatterns
      )
    ).toEqual({ dateFrom: "23-01", dateTo: "29-01-2026" });
  });

  test("Lidl text format DD.MM - DD.MM.YYYY", () => {
    expect(parseDates("Catalog 24.02 - 02.03.2026", lidlDatePatterns)).toEqual(
      { dateFrom: "24-02", dateTo: "02-03-2026" }
    );
  });

  test("Lidl text format without spaces", () => {
    expect(parseDates("24.02-02.03.2026", lidlDatePatterns)).toEqual({
      dateFrom: "24-02",
      dateTo: "02-03-2026",
    });
  });

  test("Kaufland standard date range", () => {
    expect(
      parseDates("25.02.2026-03.03.2026", kauflandDatePatterns)
    ).toEqual({ dateFrom: "25-02", dateTo: "03-03-2026" });
  });

  test("Kaufland with spaces around dash", () => {
    expect(
      parseDates("11.02.2026 - 17.02.2026", kauflandDatePatterns)
    ).toEqual({ dateFrom: "11-02", dateTo: "17-02-2026" });
  });

  test("Kaufland dates embedded in longer text", () => {
    expect(
      parseDates(
        "Catalog valabil 25.02.2026-03.03.2026 in toate magazinele",
        kauflandDatePatterns
      )
    ).toEqual({ dateFrom: "25-02", dateTo: "03-03-2026" });
  });

  test("returns null for text without dates", () => {
    expect(parseDates("some-random-slug", lidlDatePatterns)).toBeNull();
    expect(parseDates("no dates here", kauflandDatePatterns)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseDates("", lidlDatePatterns)).toBeNull();
    expect(parseDates("", kauflandDatePatterns)).toBeNull();
  });
});

// --- Animax date patterns ---

const animaxDatePatterns: DatePattern[] = [
  {
    match:
      "(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)(?:-[IVXivx]+)?-(\\d{4})",
    flags: "i",
    dateFrom: "$1-$2",
    dateTo: "$1-$2",
  },
];

describe("parseDates — Animax FlipHTML5 slugs", () => {
  test("old-style slug: Catalog-Animax-Martie-2026", () => {
    expect(
      parseDates("Catalog-Animax-Martie-2026", animaxDatePatterns)
    ).toEqual({ dateFrom: "Martie-2026", dateTo: "Martie-2026" });
  });

  test("new-style slug with Roman numeral Part I: Aniamx-Mai-I-2026-v2", () => {
    expect(
      parseDates("Aniamx-Mai-I-2026-v2", animaxDatePatterns)
    ).toEqual({ dateFrom: "Mai-2026", dateTo: "Mai-2026" });
  });

  test("new-style slug with Roman numeral Part II: Aniamx-Mai-II-2026-v2", () => {
    expect(
      parseDates("Aniamx-Mai-II-2026-v2", animaxDatePatterns)
    ).toEqual({ dateFrom: "Mai-2026", dateTo: "Mai-2026" });
  });

  test("new-style slug without version suffix: Aniamx-Iunie-I-2026", () => {
    expect(
      parseDates("Aniamx-Iunie-I-2026", animaxDatePatterns)
    ).toEqual({ dateFrom: "Iunie-2026", dateTo: "Iunie-2026" });
  });

  test("does not match Roman numerals as month (old broken pattern would): II is not a month", () => {
    // The new pattern only matches known Romanian month names — 'II' alone must not match
    expect(
      parseDates("SomeSlug-II-2026", animaxDatePatterns)
    ).toBeNull();
  });
});

// --- applyUrlTransforms ---

describe("applyUrlTransforms", () => {
  test("replace transform", () => {
    const transforms: UrlTransform[] = [
      { type: "replace", match: "/page/\\d+", replacement: "/page/1" },
    ];
    expect(
      applyUrlTransforms("https://example.com/page/42", transforms)
    ).toBe("https://example.com/page/1");
  });

  test("replace /ar/N to /view/flyer/page/1", () => {
    const transforms: UrlTransform[] = [
      {
        type: "replace",
        match: "/ar/\\d+",
        replacement: "/view/flyer/page/1",
      },
    ];
    expect(
      applyUrlTransforms(
        "https://example.com/cataloage/test/ar/0",
        transforms
      )
    ).toBe("https://example.com/cataloage/test/view/flyer/page/1");
  });

  test("append transform", () => {
    const transforms: UrlTransform[] = [
      { type: "replace", match: "/$", replacement: "" },
      { type: "append", suffix: "/view/flyer/page/1" },
    ];
    expect(
      applyUrlTransforms(
        "https://example.com/cataloage/test/",
        transforms
      )
    ).toBe("https://example.com/cataloage/test/view/flyer/page/1");
  });

  test("else transform - condition true", () => {
    const transforms: UrlTransform[] = [
      { type: "replace", match: "/ar/\\d+/?$", replacement: "" },
      {
        type: "else",
        condition: "/page/",
        ifTrue: {
          type: "replace",
          match: "/page/\\d+",
          replacement: "/page/1",
        },
        ifFalse: {
          type: "replace",
          match: "/?$",
          replacement: "/view/flyer/page/1",
        },
      },
    ];
    expect(
      applyUrlTransforms(
        "https://example.com/view/flyer/page/5",
        transforms
      )
    ).toBe("https://example.com/view/flyer/page/1");
  });

  test("else transform - condition false (kaufland ar/ link)", () => {
    const transforms: UrlTransform[] = [
      { type: "replace", match: "/ar/\\d+/?$", replacement: "" },
      {
        type: "else",
        condition: "/page/",
        ifTrue: {
          type: "replace",
          match: "/page/\\d+",
          replacement: "/page/1",
        },
        ifFalse: {
          type: "replace",
          match: "/?$",
          replacement: "/view/flyer/page/1",
        },
      },
    ];
    expect(
      applyUrlTransforms(
        "https://leaflets.kaufland.com/ro-RO/RO_ro_leaflet6_3400_RO09-OC2/ar/3400",
        transforms
      )
    ).toBe(
      "https://leaflets.kaufland.com/ro-RO/RO_ro_leaflet6_3400_RO09-OC2/view/flyer/page/1"
    );
  });

  test("empty transforms returns original URL", () => {
    expect(applyUrlTransforms("https://example.com", [])).toBe(
      "https://example.com"
    );
  });
});

// --- extractCatalogType ---

describe("extractCatalogType", () => {
  const pattern: CatalogTypePattern = {
    match: "RO_ro_(\\w+?)[\\d_]",
    caseInsensitive: true,
    transform: "lowercase",
  };

  test("extracts leaflet type", () => {
    expect(
      extractCatalogType(
        "https://leaflets.kaufland.com/ro-RO/RO_ro_leaflet6_3400_RO09-OC2/ar/3400",
        pattern
      )
    ).toBe("leaflet");
  });

  test("extracts magazine type", () => {
    expect(
      extractCatalogType(
        "https://leaflets.kaufland.com/ro-RO/RO_ro_Magazine3_3400_RO09-OC3/ar/3400",
        pattern
      )
    ).toBe("magazine");
  });

  test("extracts wrapper type", () => {
    expect(
      extractCatalogType(
        "https://leaflets.kaufland.com/ro-RO/RO_ro_Wrapper2_3400_RO09-CL4/ar/3400",
        pattern
      )
    ).toBe("wrapper");
  });

  test("returns null for unrecognized URL", () => {
    expect(
      extractCatalogType("https://example.com/random", pattern)
    ).toBeNull();
  });

  test("returns null when no pattern provided", () => {
    expect(
      extractCatalogType("https://example.com", undefined)
    ).toBeNull();
  });
});

// --- fetchLeafletsApiDates ---

describe("fetchLeafletsApiDates", () => {
  function makeMockFetch(flyer: Record<string, unknown>) {
    return mock((_url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ flyer }),
      })
    );
  }

  const weeklyFlyer = {
    category: "Wochenaktionen Flugblatt",
    offerStartDate: "2026-04-30",
    offerEndDate: "2026-05-06",
    startDate: "2026-04-26",
    endDate: "2026-05-06",
  };

  const travelFlyer = {
    category: "Lidl Reisen",
    offerStartDate: "2026-04-29",
    offerEndDate: "2026-06-04",
    startDate: "2026-04-29",
    endDate: "2026-06-04",
  };

  const sonderflyer = {
    category: "Sonderflyer",
    offerStartDate: "2027-04-23",
    offerEndDate: "2027-04-23",
    startDate: "2026-04-19",
    endDate: "2026-07-31",
  };

  test("returns offerStartDate/offerEndDate for a weekly flyer", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(weeklyFlyer);
    const result = await fetchLeafletsApiDates("some-slug", "endpoints.leaflets.schwarz");
    expect(result).toEqual({ dateFrom: "2026-04-30", dateTo: "2026-05-06" });
  });

  test("returns null when category not in allowlist (travel flyer)", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(travelFlyer);
    const result = await fetchLeafletsApiDates(
      "last-minute-mai-juni",
      "endpoints.leaflets.schwarz",
      ["Wochenaktionen Flugblatt"]
    );
    expect(result).toBeNull();
  });

  test("returns null when category not in allowlist (Sonderflyer)", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(sonderflyer);
    const result = await fetchLeafletsApiDates(
      "eiszeit-zum-tiefpreis",
      "endpoints.leaflets.schwarz",
      ["Wochenaktionen Flugblatt"]
    );
    expect(result).toBeNull();
  });

  test("returns dates when category matches allowlist", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(weeklyFlyer);
    const result = await fetchLeafletsApiDates(
      "ab-donnerstag-30-4-flugblatt-nat",
      "endpoints.leaflets.schwarz",
      ["Wochenaktionen Flugblatt"]
    );
    expect(result).toEqual({ dateFrom: "2026-04-30", dateTo: "2026-05-06" });
  });

  test("accepts any category when allowlist is empty", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(travelFlyer);
    const result = await fetchLeafletsApiDates(
      "last-minute-mai-juni",
      "endpoints.leaflets.schwarz",
      []
    );
    expect(result).toEqual({ dateFrom: "2026-04-29", dateTo: "2026-06-04" });
  });

  test("accepts any category when no allowlist provided", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(travelFlyer);
    const result = await fetchLeafletsApiDates(
      "last-minute-mai-juni",
      "endpoints.leaflets.schwarz"
    );
    expect(result).toEqual({ dateFrom: "2026-04-29", dateTo: "2026-06-04" });
  });

  test("returns null when API call fails", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() => Promise.resolve({ ok: false, status: 404 }));
    const result = await fetchLeafletsApiDates("bad-slug", "endpoints.leaflets.schwarz");
    expect(result).toBeNull();
  });

  test("falls back to startDate/endDate when offerDates absent", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch({
      category: "Wochenaktionen Flugblatt",
      startDate: "2026-05-01",
      endDate: "2026-05-07",
    });
    const result = await fetchLeafletsApiDates("some-slug", "endpoints.leaflets.schwarz");
    expect(result).toEqual({ dateFrom: "2026-05-01", dateTo: "2026-05-07" });
  });

  // --- maxSpanDays guard ---

  const ltWeeklyFlyer = {
    category: "Visi leidiniai",
    offerStartDate: "2026-05-11",
    offerEndDate: "2026-05-17",
  };

  const ltSeasonalFlyer = {
    category: "Visi leidiniai",
    offerStartDate: "2026-04-06",
    offerEndDate: "2026-08-31",
  };

  test("accepts flyer within maxSpanDays limit (LT weekly, 6 days)", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(ltWeeklyFlyer);
    const result = await fetchLeafletsApiDates(
      "maisto-prekiu-pasiulymai-20260511-kw20-pr",
      "endpoints.leaflets.schwarz",
      undefined,
      30
    );
    expect(result).toEqual({ dateFrom: "2026-05-11", dateTo: "2026-05-17" });
  });

  test("rejects flyer exceeding maxSpanDays limit (LT seasonal, 147 days)", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(ltSeasonalFlyer);
    const result = await fetchLeafletsApiDates(
      "grilio-katalogas-2026-kw15",
      "endpoints.leaflets.schwarz",
      undefined,
      30
    );
    expect(result).toBeNull();
  });

  test("rejects flyer with category not in allowlist even if within span", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(travelFlyer);
    const result = await fetchLeafletsApiDates(
      "travel-slug",
      "endpoints.leaflets.schwarz",
      ["Wochenaktionen Flugblatt"],
      30
    );
    expect(result).toBeNull();
  });

  test("accepts flyer exactly at maxSpanDays boundary (30 days)", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch({
      category: "Tilbudsaviser",
      offerStartDate: "2026-05-01",
      offerEndDate: "2026-05-31",
    });
    const result = await fetchLeafletsApiDates(
      "exact-boundary-slug",
      "endpoints.leaflets.schwarz",
      undefined,
      30
    );
    expect(result).toEqual({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
  });

  test("rejects flyer one day over maxSpanDays boundary (31 days)", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch({
      category: "Tilbudsaviser",
      offerStartDate: "2026-05-01",
      offerEndDate: "2026-06-01",
    });
    const result = await fetchLeafletsApiDates(
      "one-over-boundary-slug",
      "endpoints.leaflets.schwarz",
      undefined,
      30
    );
    expect(result).toBeNull();
  });

  test("ignores maxSpanDays when undefined (no span limit)", async () => {
    // @ts-ignore
    globalThis.fetch = makeMockFetch(ltSeasonalFlyer);
    const result = await fetchLeafletsApiDates(
      "grilio-katalogas-2026-kw15",
      "endpoints.leaflets.schwarz"
    );
    // No maxSpanDays: long-span flyer is accepted
    expect(result).toEqual({ dateFrom: "2026-04-06", dateTo: "2026-08-31" });
  });
});

// --- discoverStoreViaLeafletsOverview ---

describe("discoverStoreViaLeafletsOverview", () => {
  function makeOverviewStore(
    subcategoryFilter?: string
  ): StoreDefinition {
    return {
      name: "lidl",
      country: "italy",
      landingUrl: "https://www.lidl.it/c/volantino-lidl/s10018048",
      waitAfterLoad: 0,
      resolver: "leaflets",
      leafletsOverviewConfig: {
        clientLocale: "lidl/it-IT",
        ...(subcategoryFilter ? { subcategoryFilter } : {}),
      },
      linkPatterns: [
        {
          match: "/l/it/volantini/([^/]+)/ar/\\d+",
          slugGroup: 1,
          normalizeUrl: [
            {
              type: "replace",
              match: "/ar/\\d+.*$",
              replacement: "/view/flyer/page/1",
            },
          ],
        },
      ],
      dateSource: "leaflets_api",
      datePatterns: [],
    };
  }

  function mockOverview(body: unknown, ok = true, status = 200) {
    return mock((_url: string) =>
      Promise.resolve({
        ok,
        status,
        json: () => Promise.resolve(body),
      })
    );
  }

  const weeklyFlyer = {
    id: "f-weekly-1",
    offerStartDate: "2026-05-14",
    offerEndDate: "2026-05-20",
    flyerUrlAbsolute:
      "https://www.lidl.it/l/it/volantini/offerte-valide-dal-14-05-al-20-05-volantino-settimanale/ar/0",
    thumbnailUrl: "https://cdn.example.com/thumb-weekly.jpg",
  };

  const specialFlyer = {
    id: "f-special-1",
    offerStartDate: "2026-05-01",
    offerEndDate: "2026-06-30",
    flyerUrlAbsolute:
      "https://www.lidl.it/l/it/volantini/vivi-il-tuo-giardino-primavera-2026/ar/0",
    thumbnailUrl: "https://cdn.example.com/thumb-special.jpg",
  };

  const twoSubcategoryResponse = {
    success: true,
    categories: [
      {
        subcategories: [
          { name: "Volantini settimanali", flyers: [weeklyFlyer] },
          { name: "Volantini speciali", flyers: [specialFlyer] },
        ],
      },
    ],
  };

  test("subcategoryFilter restricts to the matching subcategory", async () => {
    // @ts-ignore
    globalThis.fetch = mockOverview(twoSubcategoryResponse);
    const result = await discoverStoreViaLeafletsOverview(
      makeOverviewStore("Volantini settimanali")
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe(
      "offerte-valide-dal-14-05-al-20-05-volantino-settimanale"
    );
    expect(result[0]!.dateFrom).toBe("2026-05-14");
    expect(result[0]!.dateTo).toBe("2026-05-20");
  });

  test("no subcategoryFilter returns flyers from all subcategories", async () => {
    // @ts-ignore
    globalThis.fetch = mockOverview(twoSubcategoryResponse);
    const result = await discoverStoreViaLeafletsOverview(makeOverviewStore());
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.slug).sort()).toEqual([
      "offerte-valide-dal-14-05-al-20-05-volantino-settimanale",
      "vivi-il-tuo-giardino-primavera-2026",
    ]);
  });

  test("API 4xx returns empty array", async () => {
    // @ts-ignore
    globalThis.fetch = mockOverview(null, false, 404);
    const result = await discoverStoreViaLeafletsOverview(makeOverviewStore());
    expect(result).toEqual([]);
  });

  test("flyerUrlAbsolute is normalized via linkPatterns", async () => {
    // @ts-ignore
    globalThis.fetch = mockOverview(twoSubcategoryResponse);
    const result = await discoverStoreViaLeafletsOverview(
      makeOverviewStore("Volantini settimanali")
    );
    expect(result[0]!.firstPageUrl).toBe(
      "https://www.lidl.it/l/it/volantini/offerte-valide-dal-14-05-al-20-05-volantino-settimanale/view/flyer/page/1"
    );
  });

  test("empty categories array returns empty result", async () => {
    // @ts-ignore
    globalThis.fetch = mockOverview({ success: true, categories: [] });
    const result = await discoverStoreViaLeafletsOverview(makeOverviewStore());
    expect(result).toEqual([]);
  });

  test("flyer with missing dates is skipped", async () => {
    // @ts-ignore
    globalThis.fetch = mockOverview({
      success: true,
      categories: [
        {
          subcategories: [
            {
              name: "Volantini settimanali",
              flyers: [
                {
                  id: "f-no-dates",
                  flyerUrlAbsolute:
                    "https://www.lidl.it/l/it/volantini/no-dates/ar/0",
                },
                weeklyFlyer,
              ],
            },
          ],
        },
      ],
    });
    const result = await discoverStoreViaLeafletsOverview(makeOverviewStore());
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe(
      "offerte-valide-dal-14-05-al-20-05-volantino-settimanale"
    );
  });
});
