import { describe, expect, test } from "bun:test";
import { extractPageNumber, buildPageURL } from "../src/resolver.ts";

describe("extractPageNumber", () => {
  test("standard URL extracts correct number", () => {
    expect(
      extractPageNumber("https://example.com/catalog/page/42")
    ).toBe(42);
  });

  test("page 1", () => {
    expect(
      extractPageNumber("https://example.com/catalog/page/1")
    ).toBe(1);
  });

  test("large page number", () => {
    expect(
      extractPageNumber("https://example.com/catalog/page/999")
    ).toBe(999);
  });

  test("no /page/ segment throws", () => {
    expect(() =>
      extractPageNumber("https://example.com/catalog/42")
    ).toThrow("Page number not found");
  });

  test("empty string throws", () => {
    expect(() => extractPageNumber("")).toThrow("Page number not found");
  });
});

describe("buildPageURL", () => {
  test("replace page 1 with page 42", () => {
    expect(
      buildPageURL("https://example.com/catalog/page/1", 42)
    ).toBe("https://example.com/catalog/page/42");
  });

  test("replace page 69 with page 5", () => {
    expect(
      buildPageURL("https://example.com/catalog/page/69", 5)
    ).toBe("https://example.com/catalog/page/5");
  });

  test("single-digit to multi-digit", () => {
    expect(
      buildPageURL("https://example.com/catalog/page/3", 100)
    ).toBe("https://example.com/catalog/page/100");
  });
});
