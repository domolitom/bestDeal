import type { StorageAdapter } from "@bestdeal/shared";
import type { ResolveResult } from "./resolver-types.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "downloader" });

/**
 * Download all images from a resolve result and write them through the storage adapter.
 * Returns the filename of the thumbnail if one was successfully written, otherwise undefined.
 */
export async function downloadCatalogImages(
  result: ResolveResult,
  storage: StorageAdapter
): Promise<{ coverThumb?: string }> {
  const { catalogId, coverImageUrl, coverThumbUrl, pages } = result;

  // Download cover image (use first page's imageData if available)
  const coverData = pages[0]?.imageData;
  if (coverData) {
    await storage.writeImage(catalogId, "cover.jpg", coverData);
    log.info(`wrote cover image from page data`, { catalogId });
  } else if (coverImageUrl) {
    try {
      const data = await downloadImage(coverImageUrl);
      await storage.writeImage(catalogId, "cover.jpg", data);
      log.info(`downloaded cover image`, { catalogId });
    } catch (err) {
      log.warn(`cover image failed`, { catalogId, err: String(err) });
    }
  }

  // Download cover thumbnail when the resolver provided a smaller image URL.
  // Thumbnails are written as cover-thumb.jpg alongside cover.jpg.
  let coverThumb: string | undefined;
  if (coverThumbUrl) {
    try {
      const thumbData = await downloadImage(coverThumbUrl);
      await storage.writeImage(catalogId, "cover-thumb.jpg", thumbData);
      coverThumb = "cover-thumb.jpg";
      log.info(`downloaded cover thumbnail`, { catalogId });
    } catch (err) {
      log.warn(`cover thumbnail failed`, { catalogId, err: String(err) });
    }
  }

  // Download each page
  for (const page of pages) {
    const filename = `page-${String(page.number).padStart(3, "0")}.jpg`;
    try {
      const data = page.imageData ?? await downloadImage(page.imageUrl);
      await storage.writeImage(catalogId, filename, data);
      log.info(`downloaded page ${page.number}`);
    } catch (err) {
      log.warn(`page ${page.number} failed`, { err: String(err) });
    }
  }

  log.info(`done`, { catalogId, pages: pages.length });
  return { coverThumb };
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
