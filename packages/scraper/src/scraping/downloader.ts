import type { StorageAdapter } from "@bestdeal/shared";
import type { ResolveResult } from "./resolver-types.ts";

/**
 * Download all images from a resolve result and write them through the storage adapter.
 */
export async function downloadCatalogImages(
  result: ResolveResult,
  storage: StorageAdapter
): Promise<void> {
  const { catalogId, coverImageUrl, pages } = result;

  // Download cover image (use first page's imageData if available)
  const coverData = pages[0]?.imageData;
  if (coverData) {
    await storage.writeImage(catalogId, "cover.jpg", coverData);
    console.log(`[downloader] wrote cover image from page data for ${catalogId}`);
  } else if (coverImageUrl) {
    try {
      const data = await downloadImage(coverImageUrl);
      await storage.writeImage(catalogId, "cover.jpg", data);
      console.log(`[downloader] downloaded cover image for ${catalogId}`);
    } catch (err) {
      console.warn(`[downloader] warning: cover image failed: ${err}`);
    }
  }

  // Download each page
  for (const page of pages) {
    const filename = `page-${String(page.number).padStart(3, "0")}.jpg`;
    try {
      const data = page.imageData ?? await downloadImage(page.imageUrl);
      await storage.writeImage(catalogId, filename, data);
      console.log(`[downloader] downloaded page ${page.number}`);
    } catch (err) {
      console.warn(
        `[downloader] warning: page ${page.number} failed: ${err}`
      );
    }
  }

  console.log(
    `[downloader] done — ${pages.length} pages downloaded for ${catalogId}`
  );
}

async function downloadImage(imageURL: string): Promise<Buffer> {
  const url = new URL(imageURL);
  const resp = await fetch(imageURL, {
    headers: {
      "Referer": `${url.protocol}//${url.host}/`,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer);
}
