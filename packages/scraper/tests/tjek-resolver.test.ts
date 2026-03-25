import { describe, expect, test } from "bun:test";
import { parseTjekPages } from "../src/scraping/tjek-resolver.ts";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";

// Simulate the HTML structure that Netto Poland serves.
// Each catalog appears as img src attributes with percent-encoded S3 paths.
function makeTjekUrl(id: string, page: number, extra = ""): string {
  const encoded = encodeURIComponent(`s3://sgn-prd-assets/uploads/${id}/p-${page}.webp`);
  return `image-transformer-api.tjek.com/?u=${encoded}&amp;w=700&amp;s=abc123${extra}`;
}

const CATALOG_ID = "Hg-8LAH9";
const SMALL_ID = "6rCp_WaX"; // Only 4 pages — dealer logo set

function buildMockHtml(catalogPages: number, smallPages: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= catalogPages; i++) {
    lines.push(`<img src="https://${makeTjekUrl(CATALOG_ID, i)}">`);
    // Each page appears twice in real HTML (thumbnail + preload)
    lines.push(`<img src="https://${makeTjekUrl(CATALOG_ID, i)}">`);
  }
  for (let i = 1; i <= smallPages; i++) {
    lines.push(`<img src="https://${makeTjekUrl(SMALL_ID, i)}">`);
  }
  return lines.join("\n");
}

describe("parseTjekPages", () => {
  test("extracts all pages for the largest catalog", () => {
    const html = buildMockHtml(29, 4);
    const { tjekCatalogId, pages } = parseTjekPages(html);

    expect(tjekCatalogId).toBe(CATALOG_ID);
    expect(pages).toHaveLength(29);
    expect(pages[0]!.number).toBe(1);
    expect(pages[28]!.number).toBe(29);
  });

  test("deduplicates repeated page URLs", () => {
    // Each page appears twice — must deduplicate
    const html = buildMockHtml(10, 0);
    const { pages } = parseTjekPages(html);
    expect(pages).toHaveLength(10);
  });

  test("sorts pages in ascending order", () => {
    const html = buildMockHtml(5, 0);
    const { pages } = parseTjekPages(html);
    const numbers = pages.map((p) => p.number);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  test("prefers catalog with most pages over smaller asset sets", () => {
    const html = buildMockHtml(29, 4);
    const { tjekCatalogId } = parseTjekPages(html);
    expect(tjekCatalogId).toBe(CATALOG_ID);
    expect(tjekCatalogId).not.toBe(SMALL_ID);
  });

  test("imageUrl is a full https URL", () => {
    const html = buildMockHtml(3, 0);
    const { pages } = parseTjekPages(html);
    for (const page of pages) {
      expect(page.imageUrl).toMatch(/^https:\/\/image-transformer-api\.tjek\.com/);
      expect(page.imageUrl).toContain("w=700");
    }
  });

  test("returns empty pages for HTML with no Tjek URLs", () => {
    const { tjekCatalogId, pages } = parseTjekPages("<html><body>nothing here</body></html>");
    expect(pages).toHaveLength(0);
    expect(tjekCatalogId).toBe("");
  });

  test("handles &amp; entity encoding in URLs", () => {
    // Real HTML uses &amp; between query params
    const html = `<img src="https://${makeTjekUrl(CATALOG_ID, 1)}">`;
    const { pages } = parseTjekPages(html);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.imageUrl).toContain("&w=700");
    expect(pages[0]!.imageUrl).not.toContain("&amp;");
  });
});

describe("Tjek URL auto-detection", () => {
  test("tjek resolver requires explicit override — not auto-detected by URL", () => {
    // The firstPageUrl for Tjek stores is the store's own landing page (e.g.
    // netto.pl/gazetka-netto/), not a tjek.com URL, so auto-detection falls
    // through to 'browser'. The store config must set resolver: "tjek".
    expect(
      detectResolverName("https://netto.pl/gazetka-netto/")
    ).toBe("browser");
    expect(
      detectResolverName("https://netto.pl/gazetka-netto/", "tjek")
    ).toBe("tjek");
  });
});
