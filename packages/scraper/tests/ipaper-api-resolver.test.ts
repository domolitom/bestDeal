import { describe, expect, test, mock, beforeEach } from "bun:test";
import { parseIPaperSettings } from "../src/scraping/ipaper-api-resolver.ts";
import { detectResolverName } from "../src/scraping/resolver-registry.ts";

// Import to register the resolver
import "../src/scraping/ipaper-api-resolver.ts";

const mockHtml = `
<html><head>
<script>
window.staticSettings = {"paperId":3003214,"pages":[1,2,3,4,5],"spreads":[[1,2],[3,4],[5]],"image":{"normalWidth":713,"normalHeight":981},"aws":{"url":"https://b-cdn.ipaper.io/iPaper/Papers/8ab875f0-3e43-4256-9593-7b6d365cb400/","fileOptimizedUrl":"https://files.b-cdn.ipaper.io/iPaper/Files/Optimize/","fileUrl":"https://files.b-cdn.ipaper.io/iPaper/Files/","policy":"Policy=eyJ0ZXN0IjoxfQ__&Signature=abc123&Key-Pair-Id=APKATEST"}};
window.dataStore = {"flipbookName":"Test"};
</script></head></html>`;

describe("parseIPaperSettings", () => {
  test("extracts pages and aws from HTML", () => {
    const settings = parseIPaperSettings(mockHtml);
    expect(settings).not.toBeNull();
    expect(settings!.pages).toEqual([1, 2, 3, 4, 5]);
    expect(settings!.aws.url).toBe(
      "https://b-cdn.ipaper.io/iPaper/Papers/8ab875f0-3e43-4256-9593-7b6d365cb400/"
    );
    expect(settings!.aws.policy).toBe(
      "Policy=eyJ0ZXN0IjoxfQ__&Signature=abc123&Key-Pair-Id=APKATEST"
    );
  });

  test("returns null for non-iPaper HTML", () => {
    expect(parseIPaperSettings("<html><body>hello</body></html>")).toBeNull();
  });

  test("returns null if pages missing", () => {
    const html = `<script>window.staticSettings = {"aws":{"url":"x","policy":"y"}};</script>`;
    expect(parseIPaperSettings(html)).toBeNull();
  });

  test("returns null if aws missing", () => {
    const html = `<script>window.staticSettings = {"pages":[1,2]};</script>`;
    expect(parseIPaperSettings(html)).toBeNull();
  });
});

describe("iPaper URL detection", () => {
  test("detects ipapercms.dk URLs", () => {
    expect(
      detectResolverName("https://ipaper.ipapercms.dk/SomeCompany/catalog/")
    ).toBe("ipaper");
  });

  test("detects CampaignPaper URLs", () => {
    expect(
      detectResolverName(
        "https://brosura-de-campanie.jysk.ro/CampaignPaper/abc-123/"
      )
    ).toBe("ipaper");
  });

  test("detects ipaper.io URLs", () => {
    expect(
      detectResolverName("https://b-cdn.ipaper.io/iPaper/Papers/uuid/")
    ).toBe("ipaper");
  });

  test("respects manual override", () => {
    expect(
      detectResolverName(
        "https://brosura-de-campanie.jysk.ro/CampaignPaper/abc/",
        "browser"
      )
    ).toBe("browser");
  });
});

describe("resolveViaIPaperApi", () => {
  beforeEach(() => {
    // @ts-ignore - mock global fetch
    globalThis.fetch = mock((url: string) => {
      if (url.includes("CampaignPaper") || url.includes("ipapercms")) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(mockHtml),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
    });
  });

  test("resolves all pages from iPaper HTML", async () => {
    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://brosura-de-campanie.jysk.ro/CampaignPaper/abc-123/"
    );

    expect(resolver.name).toBe("ipaper");
    expect(resolver.needsLastPage).toBe(false);

    const result = await resolver.resolve({
      catalogId: "romania-jysk-2026-03-06-2026-03-19",
      firstPageUrl:
        "https://brosura-de-campanie.jysk.ro/CampaignPaper/abc-123/",
    });

    expect(result.catalogId).toBe("romania-jysk-2026-03-06-2026-03-19");
    expect(result.pages).toHaveLength(5);
    expect(result.pages[0]!.number).toBe(1);
    expect(result.pages[0]!.imageUrl).toBe(
      "https://b-cdn.ipaper.io/iPaper/Papers/8ab875f0-3e43-4256-9593-7b6d365cb400/Pages/1.jpg?Policy=eyJ0ZXN0IjoxfQ__&Signature=abc123&Key-Pair-Id=APKATEST"
    );
    expect(result.pages[4]!.number).toBe(5);
    expect(result.pages[4]!.imageUrl).toContain("/Pages/5.jpg?");
    expect(result.coverImageUrl).toBe(result.pages[0]!.imageUrl);
  });

  test("throws on non-iPaper HTML", async () => {
    // @ts-ignore
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve("<html>not ipaper</html>"),
      })
    );

    const { getResolver } = await import(
      "../src/scraping/resolver-registry.ts"
    );
    const resolver = getResolver(
      "https://brosura-de-campanie.jysk.ro/CampaignPaper/abc/"
    );

    expect(
      resolver.resolve({
        catalogId: "test",
        firstPageUrl:
          "https://brosura-de-campanie.jysk.ro/CampaignPaper/abc/",
      })
    ).rejects.toThrow("Could not extract iPaper settings");
  });
});
