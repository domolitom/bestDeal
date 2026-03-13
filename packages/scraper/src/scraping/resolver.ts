import type { Page } from "playwright";
import { chromium } from "../browser.ts";
import { buildPageURL, extractPageNumber } from "@bestdeal/shared";
import type { ImageExtraction } from "@bestdeal/shared";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

import type { ResolveResult } from "./resolver-types.ts";

// --- Image extraction (runs inside the browser) ---

async function extractImageFromPage(
  page: Page,
  url: string,
  imageConfig?: ImageExtraction
): Promise<string> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("img", { timeout: 15000 });
  await page.waitForTimeout(3000);

  // We need to serialize the config for browser context
  const minW = imageConfig?.minWidth ?? 500;
  const minH = imageConfig?.minHeight ?? 500;
  const excludes = imageConfig?.excludeSelectors ?? [
    "nav",
    "aside",
    ".cuprins",
    '[class*="sidebar"]',
    '[class*="thumbnail"]',
  ];

  const result = await page.evaluate(
    ({ minW, minH, excludes }) => {
      const currentPages = document.querySelectorAll(
        ".page--current img, [class*='page--current'] img"
      );
      const candidates =
        currentPages.length > 0
          ? (Array.from(currentPages) as HTMLImageElement[])
          : (
              Array.from(
                document.querySelectorAll("img")
              ) as HTMLImageElement[]
            ).filter((img) => !excludes.some((sel) => img.closest(sel)));

      const good = candidates.filter((img) => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        return (
          img.complete &&
          w > minW &&
          h > minH &&
          img.src &&
          !img.src.includes("data:image") &&
          !img.src.includes("rs:fit:400") &&
          !img.src.includes("rs:fit:200")
        );
      });

      if (good.length > 0) {
        return { success: true as const, url: good[0]!.src };
      }
      return { success: false as const };
    },
    { minW, minH, excludes }
  );

  if (!result.success || !("url" in result)) {
    throw new Error("No image found on page");
  }

  let imageURL = result.url;
  if (!imageURL.startsWith("http")) {
    const parsed = new URL(url);
    imageURL = `${parsed.protocol}//${parsed.host}${imageURL}`;
  }

  return imageURL;
}

// --- Main resolver ---

interface ResolveOptions {
  firstPageUrl: string;
  lastPage: number;
  coverImageUrl: string;
  catalogId: string;
  delayBetweenPages?: number;
  imageExtraction?: ImageExtraction;
}

async function resolvePages(
  options: ResolveOptions
): Promise<ResolveResult> {
  const {
    firstPageUrl,
    lastPage,
    coverImageUrl,
    catalogId,
    delayBetweenPages = 3000,
    imageExtraction,
  } = options;

  console.log(`[resolver] starting for ${catalogId}`);

  const firstPageNum = extractPageNumber(firstPageUrl);

  const browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({
    viewport: { width: 800, height: 1200 },
  });
  let page = await context.newPage();

  const REFRESH_EVERY = 15; // restart browser context every N pages

  try {
    const result: ResolveResult = {
      catalogId,
      coverImageUrl: "",
      pages: [],
    };

    // Resolve cover image
    console.log(`[resolver] resolving cover image: ${coverImageUrl}`);
    try {
      result.coverImageUrl = await extractImageFromPage(
        page,
        coverImageUrl,
        imageExtraction
      );
    } catch (err) {
      console.warn(`[resolver] warning: cover image failed: ${err}`);
    }

    // Resolve each page
    console.log(`[resolver] resolving pages ${firstPageNum}-${lastPage}`);
    let consecutiveFailures = 0;

    for (let pageNum = firstPageNum; pageNum <= lastPage; pageNum++) {
      // Refresh browser context periodically to avoid rate-limiting
      const pageIndex = pageNum - firstPageNum;
      if (pageIndex > 0 && pageIndex % REFRESH_EVERY === 0) {
        console.log(`[resolver] refreshing browser context...`);
        await context.close();
        context = await browser.newContext({
          viewport: { width: 800, height: 1200 },
        });
        page = await context.newPage();
        await new Promise((r) => setTimeout(r, 5000));
      }

      const pageURL = buildPageURL(firstPageUrl, pageNum);
      console.log(`[resolver] page ${pageNum}/${lastPage}: ${pageURL}`);

      try {
        const imageURL = await extractImageFromPage(
          page,
          pageURL,
          imageExtraction
        );
        result.pages.push({ number: pageNum, imageUrl: imageURL });
        consecutiveFailures = 0;
      } catch (err) {
        console.warn(`[resolver] warning: page ${pageNum} failed: ${err}`);
        consecutiveFailures++;
        if (consecutiveFailures >= 5) {
          console.warn(
            `[resolver] aborting — ${consecutiveFailures} consecutive failures`
          );
          break;
        }
      }

      await new Promise((r) => setTimeout(r, delayBetweenPages));
    }

    console.log(
      `[resolver] resolved ${result.pages.length} pages for ${catalogId}`
    );
    return result;
  } finally {
    await browser.close();
  }
}

// --- CatalogResolver implementation ---

const browserResolver: CatalogResolver = {
  name: "browser",
  needsLastPage: true,
  resolve: async (input: ResolveInput) => {
    return resolvePages({
      firstPageUrl: input.firstPageUrl,
      lastPage: input.lastPage ?? 1,
      coverImageUrl: input.coverImageUrl ?? input.firstPageUrl,
      catalogId: input.catalogId,
      delayBetweenPages: input.delayBetweenPages,
      imageExtraction: input.imageExtraction,
    });
  },
};

registerResolver(browserResolver);
