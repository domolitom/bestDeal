import { describe, expect, test } from "bun:test";
import { isManifestEligible } from "../src/pipeline.ts";

/**
 * Helper: return an ISO date string offset by `days` from today.
 * Positive = future, negative = past.
 */
function isoOffset(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

const TODAY = isoOffset(0);
const VALID_FROM = isoOffset(-7); // one week ago

describe("isManifestEligible", () => {
  test("valid catalog passes", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: VALID_FROM, dateTo: isoOffset(7) })
    ).toBe(true);
  });

  test("unparseable dateFrom fails", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: "not-a-date", dateTo: isoOffset(7) })
    ).toBe(false);
  });

  test("unparseable dateTo fails", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: VALID_FROM, dateTo: "garbage" })
    ).toBe(false);
  });

  test("both dates unparseable fails", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: "bad", dateTo: "worse" })
    ).toBe(false);
  });

  test("inverted date range (dateTo before dateFrom) fails", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: isoOffset(5), dateTo: isoOffset(2) })
    ).toBe(false);
  });

  test("dateTo 400 days in the future fails", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: VALID_FROM, dateTo: isoOffset(400) })
    ).toBe(false);
  });

  test("dateTo exactly 365 days ahead passes (boundary)", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: VALID_FROM, dateTo: isoOffset(365) })
    ).toBe(true);
  });

  test("dateTo 366 days ahead fails (just over boundary)", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: VALID_FROM, dateTo: isoOffset(366) })
    ).toBe(false);
  });

  test("dateTo 31 days in the past fails", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: isoOffset(-38), dateTo: isoOffset(-31) })
    ).toBe(false);
  });

  test("dateTo 29 days in the past passes (within 30-day window)", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: isoOffset(-35), dateTo: isoOffset(-29) })
    ).toBe(true);
  });

  test("dateTo exactly today passes", () => {
    expect(
      isManifestEligible({ id: "test", dateFrom: VALID_FROM, dateTo: TODAY })
    ).toBe(true);
  });

  test("dateTo exactly 30 days ago is on the cutoff boundary (should pass)", () => {
    // cutoff = today - 30 days; to < cutoff fails; to === cutoff passes
    expect(
      isManifestEligible({ id: "test", dateFrom: isoOffset(-37), dateTo: isoOffset(-30) })
    ).toBe(true);
  });
});
