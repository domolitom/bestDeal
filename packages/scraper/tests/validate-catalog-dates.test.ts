import { describe, expect, test } from "bun:test";
import { validateCatalogDates } from "../src/discovery/discoverer.ts";

// Fixed clock: all date-relative assertions are deterministic.
const NOW = new Date("2026-10-01T06:00:00.000Z");

describe("validateCatalogDates (future guard)", () => {
  test("typical weekly leaflet passes", () => {
    expect(validateCatalogDates("2026-10-05", "2026-10-10", NOW)).toBeNull();
  });

  test("austria-lidl-2027-04-23 single-day far-future catalog is rejected", () => {
    const r = validateCatalogDates("2027-04-23", "2027-04-23", NOW);
    expect(r).toContain("days in the future");
  });

  test("dateTo exactly 90 days ahead passes; 91 is rejected", () => {
    expect(validateCatalogDates("2026-12-01", "2026-12-30", NOW)).toBeNull();
    expect(validateCatalogDates("2026-12-01", "2026-12-31", NOW)).toContain("days in the future");
  });
});

describe("validateCatalogDates (span guard)", () => {
  test("60-day span passes, 61-day span is rejected by default", () => {
    expect(validateCatalogDates("2026-10-01", "2026-11-30", NOW)).toBeNull();
    expect(validateCatalogDates("2026-10-01", "2026-12-01", NOW)).toContain("date span is 61 days (max 60)");
  });

  test("246-day span (Lithuania Lidl case) is rejected by default", () => {
    expect(validateCatalogDates("2026-01-31", "2026-10-04", NOW)).toContain("date span");
  });

  test("per-store override allows a longer span", () => {
    expect(validateCatalogDates("2026-10-01", "2026-12-15", NOW, 90)).toBeNull();
    expect(validateCatalogDates("2026-10-01", "2026-12-15", NOW, 60)).toContain("date span");
  });
});
