import { chromium } from "../browser.ts";
import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

interface IPaperSettings {
  pages: number[];
  aws: {
    url: string;
    policy: string;
  };
}

/**
 * Extract the iPaper staticSettings JSON from raw HTML.
 * iPaper embeds `window.staticSettings = { ... };` in the page.
 */
export function parseIPaperSettings(html: string): IPaperSettings | null {
  const match = html.match(
    /window\.staticSettings\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/
  );
  if (!match?.[1]) return null;

  try {
    const settings = JSON.parse(match[1]);
    const pages: number[] = settings.pages;
    const aws = settings.aws;

    if (!Array.isArray(pages) || !aws?.url || !aws?.policy) return null;

    return { pages, aws: { url: aws.url, policy: aws.policy } };
  } catch {
    return null;
  }
}

/**
 * iPaper embeds page settings in window.staticSettings.
 * We use Playwright to extract the settings (which include signed AWS URLs),
 * then construct Zoom-quality image URLs for each page.
 */
async function resolveViaIPaperApi(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  console.log(`[ipaper-api] fetching ${firstPageUrl} via browser`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(firstPageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    // Extract settings from the page
    const settings = await page.evaluate(() => {
      const w = window as any;
      const s = w.staticSettings;
      if (!s?.pages || !s?.aws) return null;
      return {
        pages: s.pages as number[],
        aws: { url: s.aws.url as string, policy: s.aws.policy as string },
      };
    });

    if (!settings) {
      throw new Error(
        `Could not extract iPaper settings from: ${firstPageUrl}`
      );
    }

    const { pages: pageNumbers, aws } = settings;
    console.log(`[ipaper-api] found ${pageNumbers.length} pages`);

    // Build Zoom-quality image URLs — downloaded by the downloader with Referer headers
    const resolvedPages: ResolvedPage[] = pageNumbers.map((nr) => ({
      number: nr,
      imageUrl: `${aws.url}Pages/${nr}/Zoom.jpg?${aws.policy}`,
    }));

    console.log(
      `[ipaper-api] got ${resolvedPages.length} pages for ${catalogId}`
    );

    return {
      catalogId,
      coverImageUrl: resolvedPages[0]?.imageUrl ?? "",
      pages: resolvedPages,
    };
  } finally {
    await browser.close();
  }
}

// --- CatalogResolver implementation ---

const ipaperResolver: CatalogResolver = {
  name: "ipaper",
  needsLastPage: false,
  resolve: resolveViaIPaperApi,
};

registerResolver(ipaperResolver);
