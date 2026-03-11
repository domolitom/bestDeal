import { describe, expect, test } from "bun:test";
import { buildCatalogId, parseCatalogId } from "@bestdeal/shared";

describe("buildCatalogId", () => {
  test("Romanian Lidl catalog", () => {
    expect(
      buildCatalogId({
        country: "romania",
        store: "lidl",
        dateFrom: "09-02",
        dateTo: "15-02-2026",
      })
    ).toBe("romania-lidl-2026-02-09-2026-02-15");
  });

  test("Romanian Kaufland catalog without type", () => {
    expect(
      buildCatalogId({
        country: "romania",
        store: "kaufland",
        dateFrom: "11-02",
        dateTo: "17-02-2026",
      })
    ).toBe("romania-kaufland-2026-02-11-2026-02-17");
  });

  test("Romanian Kaufland catalog with type", () => {
    expect(
      buildCatalogId({
        country: "romania",
        store: "kaufland",
        dateFrom: "25-02",
        dateTo: "03-03-2026",
        catalogType: "leaflet",
      })
    ).toBe("romania-kaufland-2026-02-25-2026-03-03-leaflet");
  });

  test("German Lidl catalog", () => {
    expect(
      buildCatalogId({
        country: "germany",
        store: "lidl",
        dateFrom: "01-03",
        dateTo: "07-03-2026",
      })
    ).toBe("germany-lidl-2026-03-01-2026-03-07");
  });
});

describe("parseCatalogId", () => {
  test("parses standard ID", () => {
    expect(parseCatalogId("romania-lidl-2026-02-09-2026-02-15")).toEqual({
      country: "romania",
      store: "lidl",
      dateFrom: "2026-02-09",
      dateTo: "2026-02-15",
      catalogType: undefined,
    });
  });

  test("parses ID with catalog type", () => {
    expect(
      parseCatalogId("romania-kaufland-2026-02-25-2026-03-03-leaflet")
    ).toEqual({
      country: "romania",
      store: "kaufland",
      dateFrom: "2026-02-25",
      dateTo: "2026-03-03",
      catalogType: "leaflet",
    });
  });

  test("parses ID with hyphenated store name", () => {
    expect(
      parseCatalogId("romania-mega-image-2026-02-09-2026-02-15")
    ).toEqual({
      country: "romania",
      store: "mega-image",
      dateFrom: "2026-02-09",
      dateTo: "2026-02-15",
      catalogType: undefined,
    });
  });

  test("returns null for invalid ID", () => {
    expect(parseCatalogId("invalid")).toBeNull();
    expect(parseCatalogId("")).toBeNull();
    expect(parseCatalogId("lidl-09-02-15-02-2026")).toBeNull();
  });
});
