import { describe, expect, test } from "bun:test";
import { parseLeafletsApiFlyer } from "../src/discovery/discovery-engine.ts";
import { validateCatalogDates } from "../src/discovery/discoverer.ts";

/**
 * bestDeal-xej / bestDeal-fzm: the Schwarz Leaflets API passes offerStartDate /
 * offerEndDate through verbatim (the parser does no date arithmetic), so
 * the 246-day LT spans and the single-day AT 2027-04-23 catalog were real API
 * values for non-weekly flyers sharing the weekly category. The parser must
 * stay faithful; rejection is the job of the category allowlist,
 * leafletsMaxSpanDays, and validateCatalogDates.
 */
const NOW = new Date("2026-10-01T06:00:00.000Z");

describe("leaflets API date quality", () => {
  const ltSeasonal = {
    category: "Visi leidiniai",
    offerStartDate: "2026-01-31",
    offerEndDate: "2026-10-04", // 246 days
  };
  const atOneDay = {
    category: "Wochenaktionen Flugblatt",
    offerStartDate: "2027-04-23",
    offerEndDate: "2027-04-23",
  };

  test("parser passes API dates through unchanged (no parsing bug)", () => {
    expect(parseLeafletsApiFlyer(ltSeasonal, "lt")).toEqual({
      dateFrom: "2026-01-31",
      dateTo: "2026-10-04",
    });
  });

  test("LT 246-day flyer is dropped by leafletsMaxSpanDays=30", () => {
    expect(parseLeafletsApiFlyer(ltSeasonal, "lt", ["Visi leidiniai"], 30)).toBeNull();
  });

  test("LT 246-day flyer is also rejected by discovery validation when config guard is absent", () => {
    const d = parseLeafletsApiFlyer(ltSeasonal, "lt")!;
    expect(validateCatalogDates(d.dateFrom, d.dateTo, NOW)).toContain("date span is 246 days");
  });

  test("AT single-day far-future flyer passes the span guard but is rejected by the future guard", () => {
    const d = parseLeafletsApiFlyer(atOneDay, "at", ["Wochenaktionen Flugblatt"], 30)!;
    expect(d).not.toBeNull();
    expect(validateCatalogDates(d.dateFrom, d.dateTo, NOW)).toContain("days in the future");
  });
});
