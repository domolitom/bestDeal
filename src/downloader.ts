import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Manifest } from "./resolver.ts";

export async function downloadFromManifest(manifest: Manifest): Promise<void> {
  const baseDir = join("newsletters", manifest.id);
  const pagesDir = join(baseDir, "pages");
  await mkdir(pagesDir, { recursive: true });

  // Download cover image
  if (manifest.cover_image_url) {
    const coverPath = join(baseDir, "cover-image.jpg");
    try {
      await downloadImage(manifest.cover_image_url, coverPath);
      console.log("[downloader] downloaded cover image");
    } catch (err) {
      console.warn(`[downloader] warning: cover image failed: ${err}`);
    }
  }

  // Download each page
  for (const page of manifest.pages) {
    const filename = `page-${String(page.number).padStart(3, "0")}.jpg`;
    const dest = join(pagesDir, filename);

    try {
      await downloadImage(page.image_url, dest);
      console.log(`[downloader] downloaded page ${page.number}`);
    } catch (err) {
      console.warn(`[downloader] warning: page ${page.number} failed: ${err}`);
    }
  }

  console.log(
    `[downloader] done — ${manifest.pages.length} pages downloaded for ${manifest.id}`
  );
}

async function downloadImage(imageURL: string, filePath: string): Promise<void> {
  const resp = await fetch(imageURL);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const buffer = await resp.arrayBuffer();
  await writeFile(filePath, Buffer.from(buffer));
}

// --- CLI entry point ---

if (import.meta.main) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error("Usage: bun run src/downloader.ts <manifest-path>");
    process.exit(1);
  }
  const raw = await readFile(manifestPath, "utf-8");
  const manifest: Manifest = JSON.parse(raw);
  await downloadFromManifest(manifest);
}
