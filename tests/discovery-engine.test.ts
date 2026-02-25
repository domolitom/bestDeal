import { describe, expect, test } from "bun:test";
import {
  parseDates,
  applyUrlTransforms,
  extractCatalogType,
} from "../src/discovery-engine.ts";
import type { DatePattern, CatalogTypePattern, UrlTransform } from "../src/store-config.ts";

// --- parseDates ---

const lidlDatePatterns: DatePattern[] = [
  { match: "(\\d{2}-\\d{2})-(\\d{2}-\\d{2}-\\d{4})$", dateFrom: "$1", dateTo: "$2" },
  { match: "(\\d{2})\\.(\\d{2})\\s*-\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})", dateFrom: "$1-$2", dateTo: "$3-$4-$5" },
];

const kauflandDatePatterns: DatePattern[] = [
  { match: "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s*-\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})", dateFrom: "$1-$2", dateTo: "$4-$5-$6" },
];

describe("parseDates", () => {
  test("Lidl slug format", () => {
    expect(
      parseDates("catalogul-saptamanal-pentru-perioada-09-02-15-02-2026", lidlDatePatterns)
    ).toEqual({ dateFrom: "09-02", dateTo: "15-02-2026" });
  });

  test("Lidl slug different range", () => {
    expect(
      parseDates("catalogul-saptamanal-pentru-perioada-23-01-29-01-2026", lidlDatePatterns)
    ).toEqual({ dateFrom: "23-01", dateTo: "29-01-2026" });
  });

  test("Lidl text format DD.MM - DD.MM.YYYY", () => {
    expect(
      parseDates("Catalog 24.02 - 02.03.2026", lidlDatePatterns)
    ).toEqual({ dateFrom: "24-02", dateTo: "02-03-2026" });
  });

  test("Lidl text format without spaces", () => {
    expect(
      parseDates("24.02-02.03.2026", lidlDatePatterns)
    ).toEqual({ dateFrom: "24-02", dateTo: "02-03-2026" });
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
      parseDates("Catalog valabil 25.02.2026-03.03.2026 in toate magazinele", kauflandDatePatterns)
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

// --- applyUrlTransforms ---

describe("applyUrlTransforms", () => {
  test("replace transform", () => {
    const transforms: UrlTransform[] = [
      { type: "replace", match: "/page/\\d+", replacement: "/page/1" },
    ];
    expect(applyUrlTransforms("https://example.com/page/42", transforms)).toBe(
      "https://example.com/page/1"
    );
  });

  test("replace /ar/N to /view/flyer/page/1", () => {
    const transforms: UrlTransform[] = [
      { type: "replace", match: "/ar/\\d+", replacement: "/view/flyer/page/1" },
    ];
    expect(
      applyUrlTransforms("https://example.com/cataloage/test/ar/0", transforms)
    ).toBe("https://example.com/cataloage/test/view/flyer/page/1");
  });

  test("append transform", () => {
    const transforms: UrlTransform[] = [
      { type: "replace", match: "/$", replacement: "" },
      { type: "append", suffix: "/view/flyer/page/1" },
    ];
    expect(
      applyUrlTransforms("https://example.com/cataloage/test/", transforms)
    ).toBe("https://example.com/cataloage/test/view/flyer/page/1");
  });

  test("else transform - condition true", () => {
    const transforms: UrlTransform[] = [
      { type: "replace", match: "/ar/\\d+/?$", replacement: "" },
      {
        type: "else",
        condition: "/page/",
        ifTrue: { type: "replace", match: "/page/\\d+", replacement: "/page/1" },
        ifFalse: { type: "replace", match: "/?$", replacement: "/view/flyer/page/1" },
      },
    ];
    expect(
      applyUrlTransforms("https://example.com/view/flyer/page/5", transforms)
    ).toBe("https://example.com/view/flyer/page/1");
  });

  test("else transform - condition false (kaufland ar/ link)", () => {
    const transforms: UrlTransform[] = [
      { type: "replace", match: "/ar/\\d+/?$", replacement: "" },
      {
        type: "else",
        condition: "/page/",
        ifTrue: { type: "replace", match: "/page/\\d+", replacement: "/page/1" },
        ifFalse: { type: "replace", match: "/?$", replacement: "/view/flyer/page/1" },
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
    expect(applyUrlTransforms("https://example.com", [])).toBe("https://example.com");
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
    expect(extractCatalogType("https://example.com/random", pattern)).toBeNull();
  });

  test("returns null when no pattern provided", () => {
    expect(extractCatalogType("https://example.com", undefined)).toBeNull();
  });
});
