import { describe, expect, test } from "bun:test";
import {
  toISODate,
  isCatalogActive,
  getFreshnessLabel,
  formatDate,
} from "@bestdeal/shared";

describe("toISODate", () => {
  test("DD-MM with fallback year", () => {
    expect(toISODate("09-02", 2026)).toBe("2026-02-09");
  });

  test("DD-MM-YYYY", () => {
    expect(toISODate("15-02-2026")).toBe("2026-02-15");
  });

  test("DD-MM without fallback uses current year", () => {
    const result = toISODate("01-01");
    const year = new Date().getFullYear();
    expect(result).toBe(`${year}-01-01`);
  });

  test("already ISO passes through", () => {
    expect(toISODate("2026-02-09")).toBe("2026-02-09");
  });

  test("Romanian abbreviated month name", () => {
    expect(toISODate("1-mar", 2026)).toBe("2026-03-01");
  });

  test("Romanian abbreviated month name dec", () => {
    expect(toISODate("15-dec", 2026)).toBe("2026-12-15");
  });
});

describe("isCatalogActive", () => {
  test("future date is active", () => {
    expect(isCatalogActive("2099-12-31")).toBe(true);
  });

  test("past date is not active", () => {
    expect(isCatalogActive("2020-01-01")).toBe(false);
  });

  test("invalid date is not active", () => {
    expect(isCatalogActive("not-a-date")).toBe(false);
  });
});

describe("formatDate", () => {
  test("formats ISO date", () => {
    const result = formatDate("2026-02-09");
    expect(result).toContain("2026");
    expect(result).toContain("Feb");
  });

  test("returns input for invalid date", () => {
    expect(formatDate("invalid")).toBe("invalid");
  });
});
