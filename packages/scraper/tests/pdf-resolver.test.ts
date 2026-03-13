import { describe, expect, test } from "bun:test";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";

// Import to register the resolver
import "../src/scraping/pdf-resolver.ts";

describe("PDF URL detection", () => {
  test("detects .pdf URLs", () => {
    expect(
      detectResolverName(
        "https://www.la-doi-pasi.ro/var/uploads/offer/Catalog_digital%20LDP%201-15%20mar.pdf"
      )
    ).toBe("pdf");
  });

  test("detects .pdf URLs with query params", () => {
    expect(
      detectResolverName("https://example.com/catalog.pdf?v=123")
    ).toBe("pdf");
  });

  test("does not match non-pdf URLs containing pdf in path", () => {
    expect(detectResolverName("https://example.com/pdf-viewer/page/1")).toBe(
      "browser"
    );
  });

  test("respects manual override", () => {
    expect(
      detectResolverName("https://example.com/catalog.pdf", "browser")
    ).toBe("browser");
  });
});
