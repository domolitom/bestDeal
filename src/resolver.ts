import { chromium, type Page } from "playwright";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// --- Types ---

interface ScraperConfig {
  id: string;
  cover_image: string;
  first_page: string;
  last_page: string;
}

export interface ManifestPage {
  number: number;
  image_url: string;
}

export interface Manifest {
  id: string;
  store: string;
  cover_image_url: string;
  pages: ManifestPage[];
}

// --- Image extraction (runs inside the browser) ---

function extractMainImage(): { success: boolean; url?: string } {
  const currentPages = document.querySelectorAll(
    ".page--current img, [class*='page--current'] img"
  );
  const candidates =
    currentPages.length > 0
      ? Array.from(currentPages) as HTMLImageElement[]
      : (Array.from(document.querySelectorAll("img")) as HTMLImageElement[]).filter(
          (img) =>
            !img.closest("nav") &&
            !img.closest("aside") &&
            !img.closest(".cuprins") &&
            !img.closest('[class*="sidebar"]') &&
            !img.closest('[class*="thumbnail"]')
        );

  const good = candidates.filter((img) => {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    return (
      img.complete &&
      w > 500 &&
      h > 500 &&
      img.src &&
      !img.src.includes("data:image") &&
      !img.src.includes("rs:fit:400") &&
      !img.src.includes("rs:fit:200")
    );
  });

  if (good.length > 0) {
    return { success: true, url: good[0]!.src };
  }
  return { success: false };
}

// --- Helpers ---

function extractPageNumber(url: string): number {
  const match = url.match(/\/page\/(\d+)/);
  if (!match) throw new Error(`Page number not found in URL: ${url}`);
  return parseInt(match[1]!, 10);
}

function buildPageURL(templateURL: string, pageNum: number): string {
  return templateURL.replace(/\/page\/\d+/, `/page/${pageNum}`);
}

async function extractImageFromPage(
  page: Page,
  url: string
): Promise<string> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("img", { timeout: 15000 });
  // Give images time to load their full src
  await page.waitForTimeout(3000);

  const result = await page.evaluate(extractMainImage);

  if (!result.success || !result.url) {
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

export async function resolveManifest(configPath: string): Promise<Manifest> {
  const raw = await readFile(configPath, "utf-8");
  const config: ScraperConfig = JSON.parse(raw);

  console.log(`[resolver] starting for ${config.id}`);

  const firstPageNum = extractPageNumber(config.first_page);
  const lastPageNum = extractPageNumber(config.last_page);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 800, height: 1200 },
  });
  const page = await context.newPage();

  try {
    // Derive store name from config ID (e.g. "lidl-09-02-15-02-2026" -> "lidl")
    const store = config.id.includes("-")
      ? config.id.slice(0, config.id.indexOf("-"))
      : config.id;

    const manifest: Manifest = {
      id: config.id,
      store,
      cover_image_url: "",
      pages: [],
    };

    // Resolve cover image
    console.log(`[resolver] resolving cover image: ${config.cover_image}`);
    try {
      manifest.cover_image_url = await extractImageFromPage(
        page,
        config.cover_image
      );
    } catch (err) {
      console.warn(`[resolver] warning: cover image failed: ${err}`);
    }

    // Resolve each page
    console.log(`[resolver] resolving pages ${firstPageNum}-${lastPageNum}`);
    for (let pageNum = firstPageNum; pageNum <= lastPageNum; pageNum++) {
      const pageURL = buildPageURL(config.first_page, pageNum);
      console.log(`[resolver] page ${pageNum}/${lastPageNum}: ${pageURL}`);

      try {
        const imageURL = await extractImageFromPage(page, pageURL);
        manifest.pages.push({ number: pageNum, image_url: imageURL });
      } catch (err) {
        console.warn(`[resolver] warning: page ${pageNum} failed: ${err}`);
      }

      // Small delay between pages to be respectful
      await new Promise((r) => setTimeout(r, 500));
    }

    // Write manifest to disk
    const baseDir = join("newsletters", config.id);
    await mkdir(baseDir, { recursive: true });

    const manifestPath = join(baseDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(
      `[resolver] manifest written to ${manifestPath} (${manifest.pages.length} pages resolved)`
    );
    return manifest;
  } finally {
    await browser.close();
  }
}

// --- CLI entry point ---

if (import.meta.main) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: bun run src/resolver.ts <config-path>");
    console.error("Example: bun run src/resolver.ts configs/lidl-09-02-15-02-2026.json");
    process.exit(1);
  }
  resolveManifest(configPath).catch((err) => {
    console.error("[resolver] fatal:", err);
    process.exit(1);
  });
}
