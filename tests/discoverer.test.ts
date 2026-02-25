import { describe, expect, test } from "bun:test";
import {
  buildConfigId,
  parseLidlDates,
  parseKauflandDates,
} from "../src/discoverer.ts";

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

  test("Kaufland catalog", () => {
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
});

describe("parseLidlDates", () => {
  test("extracts dates from standard slug", () => {
    expect(
      parseLidlDates(
        "catalogul-saptamanal-pentru-perioada-09-02-15-02-2026"
      )
    ).toEqual({ dateFrom: "09-02", dateTo: "15-02-2026" });
  });

  test("extracts dates from different date range", () => {
    expect(
      parseLidlDates(
        "catalogul-saptamanal-pentru-perioada-23-01-29-01-2026"
      )
    ).toEqual({ dateFrom: "23-01", dateTo: "29-01-2026" });
  });

  test("returns null for slug without dates", () => {
    expect(parseLidlDates("some-random-slug")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseLidlDates("")).toBeNull();
  });
});

describe("parseKauflandDates", () => {
  test("parses standard date range", () => {
    expect(parseKauflandDates("25.02.2026-03.03.2026")).toEqual({
      dateFrom: "25-02",
      dateTo: "03-03-2026",
    });
  });

  test("parses date range with spaces around dash", () => {
    expect(parseKauflandDates("11.02.2026 - 17.02.2026")).toEqual({
      dateFrom: "11-02",
      dateTo: "17-02-2026",
    });
  });

  test("parses dates embedded in longer text", () => {
    expect(
      parseKauflandDates("Catalog valabil 25.02.2026-03.03.2026 in toate magazinele")
    ).toEqual({
      dateFrom: "25-02",
      dateTo: "03-03-2026",
    });
  });

  test("returns null for text without dates", () => {
    expect(parseKauflandDates("no dates here")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseKauflandDates("")).toBeNull();
  });
});
