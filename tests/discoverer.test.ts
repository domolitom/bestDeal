import { describe, expect, test } from "bun:test";
import { buildConfigId } from "../src/discoverer.ts";

describe("buildConfigId", () => {
  test("Lidl catalog", () => {
    expect(
      buildConfigId({
        store: "lidl",
        slug: "catalogul-saptamanal-pentru-perioada-09-02-15-02-2026",
        dateFrom: "09-02",
        dateTo: "15-02-2026",
        firstPageUrl: "https://www.lidl.ro/l/ro/cataloage/test/view/flyer/page/1",
        coverImageUrl: "https://www.lidl.ro/l/ro/cataloage/test/view/flyer/page/1",
      })
    ).toBe("lidl-09-02-15-02-2026");
  });

  test("Kaufland catalog without type", () => {
    expect(
      buildConfigId({
        store: "kaufland",
        slug: "some-slug",
        dateFrom: "11-02",
        dateTo: "17-02-2026",
        firstPageUrl: "https://leaflets.kaufland.com/test/view/flyer/page/1",
        coverImageUrl: "https://leaflets.kaufland.com/test/view/flyer/page/1",
      })
    ).toBe("kaufland-11-02-17-02-2026");
  });

  test("Kaufland catalog with type", () => {
    expect(
      buildConfigId({
        store: "kaufland",
        slug: "some-slug",
        dateFrom: "25-02",
        dateTo: "03-03-2026",
        firstPageUrl: "https://leaflets.kaufland.com/test/view/flyer/page/1",
        coverImageUrl: "https://leaflets.kaufland.com/test/view/flyer/page/1",
        catalogType: "leaflet",
      })
    ).toBe("kaufland-25-02-03-03-2026-leaflet");
  });
});
