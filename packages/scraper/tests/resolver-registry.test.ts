import { describe, expect, test } from "bun:test";
import {
  detectResolverName,
  getResolver,
  registerResolver,
} from "../src/scraping/resolver-registry.ts";
import { extractFlyerSlug } from "../src/scraping/leaflets-api-resolver.ts";

// Import resolvers for side-effect registration
import "../src/scraping/leaflets-api-resolver.ts";
import "../src/scraping/resolver.ts";

describe("detectResolverName", () => {
  test("leaflets.schwarz URL → leaflets", () => {
    expect(
      detectResolverName(
        "https://leaflets.schwarz/ro/some-slug/view/flyer/page/1"
      )
    ).toBe("leaflets");
  });

  test("leaflets.kaufland URL → leaflets", () => {
    expect(
      detectResolverName(
        "https://leaflets.kaufland.com/de/some-slug/ar/1"
      )
    ).toBe("leaflets");
  });

  test("unknown URL → browser", () => {
    expect(
      detectResolverName("https://www.penny.ro/cataloage/page/1")
    ).toBe("browser");
  });

  test("override wins over auto-detection", () => {
    expect(
      detectResolverName(
        "https://leaflets.schwarz/ro/some-slug/view/flyer/page/1",
        "browser"
      )
    ).toBe("browser");
  });

  test("override works for unknown URLs", () => {
    expect(
      detectResolverName("https://example.com/page/1", "leaflets")
    ).toBe("leaflets");
  });
});

describe("getResolver", () => {
  test("returns leaflets resolver for leaflets URL", () => {
    const resolver = getResolver(
      "https://leaflets.schwarz/ro/slug/view/flyer/page/1"
    );
    expect(resolver.name).toBe("leaflets");
    expect(resolver.needsLastPage).toBe(false);
  });

  test("returns browser resolver for unknown URL", () => {
    const resolver = getResolver("https://www.penny.ro/cataloage/page/1");
    expect(resolver.name).toBe("browser");
    expect(resolver.needsLastPage).toBe(true);
  });

  test("override selects correct resolver", () => {
    const resolver = getResolver(
      "https://www.penny.ro/cataloage/page/1",
      "leaflets"
    );
    expect(resolver.name).toBe("leaflets");
  });

  test("throws for unregistered resolver name", () => {
    expect(() =>
      getResolver("https://example.com/page/1", "nonexistent")
    ).toThrow(/No resolver registered for "nonexistent"/);
  });
});

describe("extractFlyerSlug", () => {
  test("extracts slug from /view/flyer/page/ URL", () => {
    expect(
      extractFlyerSlug(
        "https://leaflets.schwarz/ro/du-26-02-au-04-03-les-promos/view/flyer/page/1"
      )
    ).toBe("du-26-02-au-04-03-les-promos");
  });

  test("extracts slug from /ar/ URL", () => {
    expect(
      extractFlyerSlug("https://leaflets.schwarz/ro/my-slug/ar/1")
    ).toBe("my-slug");
  });

  test("returns null for URL without slug pattern", () => {
    expect(extractFlyerSlug("https://example.com/page/1")).toBeNull();
  });
});
