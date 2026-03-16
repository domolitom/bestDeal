import { describe, it, expect } from "bun:test";
import { isCdnManifest, isCatalogMeta } from "../cdn-read-adapter";

describe("isCatalogMeta", () => {
  it("accepts a valid catalog meta", () => {
    expect(
      isCatalogMeta({
        id: "romania-lidl-2026-03-10-2026-03-16",
        store: "lidl",
        country: "romania",
        status: "ready",
        pageCount: 12,
        dateFrom: "2026-03-10",
        dateTo: "2026-03-16",
      })
    ).toBe(true);
  });

  it("rejects null", () => {
    expect(isCatalogMeta(null)).toBe(false);
  });

  it("rejects a string", () => {
    expect(isCatalogMeta("not an object")).toBe(false);
  });

  it("rejects object missing id", () => {
    expect(
      isCatalogMeta({ store: "lidl", country: "ro", status: "ready", pageCount: 1 })
    ).toBe(false);
  });

  it("rejects object with non-number pageCount", () => {
    expect(
      isCatalogMeta({
        id: "x",
        store: "lidl",
        country: "ro",
        status: "ready",
        pageCount: "12",
      })
    ).toBe(false);
  });
});

describe("isCdnManifest", () => {
  it("accepts a valid manifest", () => {
    expect(
      isCdnManifest({
        updatedAt: "2026-03-16T00:00:00.000Z",
        catalogs: [
          {
            id: "romania-lidl-2026-03-10-2026-03-16",
            store: "lidl",
            country: "romania",
            status: "ready",
            pageCount: 12,
            dateFrom: "2026-03-10",
            dateTo: "2026-03-16",
          },
        ],
      })
    ).toBe(true);
  });

  it("accepts an empty manifest", () => {
    expect(
      isCdnManifest({ updatedAt: "2026-03-16T00:00:00.000Z", catalogs: [] })
    ).toBe(true);
  });

  it("rejects null", () => {
    expect(isCdnManifest(null)).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    expect(isCdnManifest({ catalogs: [] })).toBe(false);
  });

  it("rejects non-array catalogs", () => {
    expect(
      isCdnManifest({ updatedAt: "2026-03-16T00:00:00.000Z", catalogs: "bad" })
    ).toBe(false);
  });

  it("rejects manifest with invalid first catalog entry", () => {
    expect(
      isCdnManifest({
        updatedAt: "2026-03-16T00:00:00.000Z",
        catalogs: [{ invalid: true }],
      })
    ).toBe(false);
  });
});
