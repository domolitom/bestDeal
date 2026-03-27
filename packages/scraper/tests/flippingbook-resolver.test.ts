import { describe, expect, test, mock, beforeEach } from "bun:test";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";

// Register resolver
import "../src/scraping/flippingbook-resolver.ts";

const SAMPLE_URL = "https://files.rewe.co.at/penny/catalog-2026/";

/**
 * Build minimal FlippingBook HTML with page links up to `maxPage`.
 * Page 1 is implicit (no href="./1/" link in the source — max found is N).
 */
function buildHtml(maxPage: number): string {
  const links = Array.from(
    { length: maxPage - 1 },
    (_, i) => `<a href="./${i + 2}/">Page ${i + 2}</a>`
  ).join("\n");
  return `<html><body>${links}</body></html>`;
}

describe("flippingbook URL detection", () => {
  test("detects files.rewe.co.at URLs", () => {
    expect(detectResolverName(SAMPLE_URL)).toBe("flippingbook");
  });

  test("does not match unrelated URLs", () => {
    expect(detectResolverName("https://example.com/flipbook")).toBe("browser");
  });

  test("respects manual resolver override", () => {
    expect(detectResolverName(SAMPLE_URL, "browser")).toBe("browser");
  });
});

describe("flippingbook extractPageCount (via resolve)", () => {
  beforeEach(() => {
    // @ts-ignore
    globalThis.fetch = mock((_url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(buildHtml(24)),
      })
    );
  });

  test("resolver name and needsLastPage", async () => {
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);
    expect(resolver.name).toBe("flippingbook");
    expect(resolver.needsLastPage).toBe(false);
  });

  test("resolves correct number of pages (24)", async () => {
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    const result = await resolver.resolve({
      catalogId: "romania-penny-2026-03-01-2026-03-14",
      firstPageUrl: SAMPLE_URL,
    });

    expect(result.pages).toHaveLength(24);
    expect(result.pages[0]!.number).toBe(1);
    expect(result.pages[23]!.number).toBe(24);
  });

  test("page image URLs use quality level 3 and zero-padded numbers", async () => {
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    const result = await resolver.resolve({
      catalogId: "test",
      firstPageUrl: SAMPLE_URL,
    });

    const baseUrl = SAMPLE_URL.replace(/\/+$/, "");
    expect(result.pages[0]!.imageUrl).toBe(
      `${baseUrl}/files/assets/common/page-html5-substrates/page0001_3.jpg`
    );
    expect(result.pages[23]!.imageUrl).toBe(
      `${baseUrl}/files/assets/common/page-html5-substrates/page0024_3.jpg`
    );
  });

  test("coverImageUrl is first page URL", async () => {
    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    const result = await resolver.resolve({
      catalogId: "test",
      firstPageUrl: SAMPLE_URL,
    });

    expect(result.coverImageUrl).toBe(result.pages[0]!.imageUrl);
  });

  test("1-page catalog (no page links in HTML) returns 1 page", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("<html><body><p>No page links</p></body></html>"),
      })
    );

    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    const result = await resolver.resolve({
      catalogId: "test",
      firstPageUrl: SAMPLE_URL,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.number).toBe(1);
  });

  test("throws on non-200 response", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve(""),
      })
    );

    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    await expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl: SAMPLE_URL,
      })
    ).rejects.toThrow("404");
  });

  test("strips trailing slash from firstPageUrl in image paths", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(buildHtml(3)),
      })
    );

    const { getResolver } = await import("../src/scraping/resolver-registry.ts");
    const resolver = getResolver(SAMPLE_URL);

    const urlWithTrailingSlash = "https://files.rewe.co.at/penny/catalog-2026/";
    const result = await resolver.resolve({
      catalogId: "test",
      firstPageUrl: urlWithTrailingSlash,
    });

    // Trailing slash stripped — no double slash before "files/assets"
    expect(result.pages[0]!.imageUrl).not.toMatch(/catalog-2026\/\/files/);
    expect(result.pages[0]!.imageUrl).toContain(
      "https://files.rewe.co.at/penny/catalog-2026/files/assets"
    );
  });
});
