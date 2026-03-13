import { describe, expect, test } from "bun:test";
import { normalizeFlipHtml5Url } from "../src/scraping/fliphtml5-resolver.ts";

describe("normalizeFlipHtml5Url", () => {
  test("strips trailing slash", () => {
    expect(
      normalizeFlipHtml5Url(
        "https://online.fliphtml5.com/wmhel/Catalog-Animax-Martie-2026/"
      )
    ).toBe(
      "https://online.fliphtml5.com/wmhel/Catalog-Animax-Martie-2026"
    );
  });

  test("strips query string", () => {
    expect(
      normalizeFlipHtml5Url(
        "https://online.fliphtml5.com/wmhel/Catalog-Animax-Martie-2026/?page=3"
      )
    ).toBe(
      "https://online.fliphtml5.com/wmhel/Catalog-Animax-Martie-2026"
    );
  });

  test("strips hash", () => {
    expect(
      normalizeFlipHtml5Url(
        "https://online.fliphtml5.com/wmhel/Catalog-Animax-Martie-2026/#p=5"
      )
    ).toBe(
      "https://online.fliphtml5.com/wmhel/Catalog-Animax-Martie-2026"
    );
  });

  test("preserves clean URL", () => {
    expect(
      normalizeFlipHtml5Url(
        "https://online.fliphtml5.com/abc/My-Book"
      )
    ).toBe("https://online.fliphtml5.com/abc/My-Book");
  });
});
