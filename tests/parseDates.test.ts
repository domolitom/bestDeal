import { describe, expect, test } from "bun:test";
import { parseDatesFromId } from "../src/server.ts";

describe("parseDatesFromId", () => {
  test("valid Lidl id", () => {
    expect(parseDatesFromId("lidl-09-02-15-02-2026")).toEqual({
      validFrom: "09-02",
      validUntil: "15-02-2026",
    });
  });

  test("valid Kaufland id", () => {
    expect(parseDatesFromId("kaufland-11-02-17-02-2026")).toEqual({
      validFrom: "11-02",
      validUntil: "17-02-2026",
    });
  });

  test("no date pattern returns empty strings", () => {
    expect(parseDatesFromId("some-random-string")).toEqual({
      validFrom: "",
      validUntil: "",
    });
  });

  test("empty string returns empty strings", () => {
    expect(parseDatesFromId("")).toEqual({
      validFrom: "",
      validUntil: "",
    });
  });

  test("date-only id (no store prefix) parses correctly", () => {
    expect(parseDatesFromId("01-01-07-01-2026")).toEqual({
      validFrom: "01-01",
      validUntil: "07-01-2026",
    });
  });

  test("partial date pattern does not match", () => {
    expect(parseDatesFromId("lidl-09-02-15-02")).toEqual({
      validFrom: "",
      validUntil: "",
    });
  });
});
