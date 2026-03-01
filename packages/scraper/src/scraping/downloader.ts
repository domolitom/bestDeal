import type { StorageAdapter } from "@bestdeal/shared";
import type { ResolveResult } from "./resolver.ts";

/**
 * Download all images from a resolve result and write them through the storage adapter.
 */
export async function downloadCatalogImages(
  result: ResolveResult,
  storage: StorageAdapter
): Promise<void> {
  const { catalogId, coverImageUrl, pages } = result;

  // Download cover image
  if (coverImageUrl) {
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
      const data = await downloadImage(page.imageUrl);
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
  const resp = await fetch(imageURL);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer);
}
