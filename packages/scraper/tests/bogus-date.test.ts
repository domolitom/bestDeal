import { describe, expect, test } from "bun:test";
import { hasBogusDate } from "../src/utils/bogus-date.ts";

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

const VALID_FROM = isoOffset(-7);

describe("hasBogusDate", () => {
  test("valid date range returns null", () => {
    expect(hasBogusDate(VALID_FROM, isoOffset(7))).toBeNull();
  });

  test("unparseable dateFrom returns reason", () => {
    const result = hasBogusDate("not-a-date", isoOffset(7));
    expect(result).not.toBeNull();
    expect(result).toContain("unparseable");
  });

  test("unparseable dateTo returns reason", () => {
    const result = hasBogusDate(VALID_FROM, "garbage");
    expect(result).not.toBeNull();
    expect(result).toContain("unparseable");
  });

  test("inverted dates (dateTo < dateFrom) returns reason", () => {
    const result = hasBogusDate(isoOffset(5), isoOffset(2));
    expect(result).not.toBeNull();
    expect(result).toContain("inverted");
  });

  test("dateTo 400 days in the future returns reason", () => {
    const result = hasBogusDate(VALID_FROM, isoOffset(400));
    expect(result).not.toBeNull();
    expect(result).toContain("days in the future");
  });

  test("dateTo exactly 90 days ahead returns null (boundary)", () => {
    expect(hasBogusDate(VALID_FROM, isoOffset(90))).toBeNull();
  });

  test("dateTo 91 days ahead returns reason", () => {
    const result = hasBogusDate(VALID_FROM, isoOffset(91));
    expect(result).not.toBeNull();
    expect(result).toContain("days in the future");
  });

  test("single-day catalog ~200 days ahead is bogus (austria-lidl-2027-04-23 case)", () => {
    const now = new Date("2026-10-01T06:00:00.000Z");
    const result = hasBogusDate("2027-04-23", "2027-04-23", now);
    expect(result).toContain("days in the future");
  });

  test("dateTo 31 days in the past returns reason", () => {
    const result = hasBogusDate(isoOffset(-38), isoOffset(-31));
    expect(result).not.toBeNull();
    expect(result).toContain("expired");
  });

  test("dateTo 29 days in the past returns null (within window)", () => {
    expect(hasBogusDate(isoOffset(-35), isoOffset(-29))).toBeNull();
  });

  test("dateTo exactly today returns null", () => {
    expect(hasBogusDate(VALID_FROM, isoOffset(0))).toBeNull();
  });

  test("dateTo exactly 30 days ago returns null (on the cutoff boundary)", () => {
    expect(hasBogusDate(isoOffset(-37), isoOffset(-30))).toBeNull();
  });
});
