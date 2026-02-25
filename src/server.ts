import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveManifest } from "./resolver.ts";
import { downloadFromManifest } from "./downloader.ts";
import { discoverAll } from "./discoverer.ts";
import type { Manifest } from "./resolver.ts";

export const app = new Hono();

// CORS for development
app.use("*", cors());

// --- API routes ---

// List all newsletters (built from manifest files on disk)
app.get("/api/newsletters", async (c) => {
  const newslettersDir = "newsletters";
  let entries: string[];
  try {
    const dirEntries = await readdir(newslettersDir, { withFileTypes: true });
    entries = dirEntries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return c.json([]);
  }

  const newsletters = [];
  for (const dir of entries) {
    const manifestPath = join(newslettersDir, dir, "manifest.json");
    try {
      const raw = await readFile(manifestPath, "utf-8");
      const manifest: Manifest = JSON.parse(raw);
      newsletters.push(manifestToSummary(manifest));
    } catch {
      // No manifest — try to build summary from directory name and files
      newsletters.push(directoryToSummary(dir));
    }
  }

  return c.json(newsletters);
});

// Get single newsletter with pages
app.get("/api/newsletters/:id", async (c) => {
  const id = c.req.param("id");
  const baseDir = join("newsletters", id);

  // Try manifest first
  const manifestPath = join(baseDir, "manifest.json");
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const manifest: Manifest = JSON.parse(raw);
    return c.json(manifestToDetail(manifest));
  } catch {
    // Fall back to scanning pages directory
  }

  // Scan pages/ directory directly
  const pagesDir = join(baseDir, "pages");
  try {
    const files = await readdir(pagesDir);
    const pageFiles = files
      .filter((f) => f.match(/^page-\d+\.jpg$/))
      .sort();

    const summary = directoryToSummary(id);
    return c.json({
      ...summary,
      pages: pageFiles.map((f, i) => ({
        pageNumber: i + 1,
        imageUrl: `/newsletters/${id}/pages/${f}`,
      })),
    });
  } catch {
    return c.json({ error: "Newsletter not found" }, 404);
  }
});

// Trigger scraping
app.post("/api/scrape/:store", async (c) => {
  const configName = c.req.param("store");
  const configPath = `configs/${configName}.json`;

  console.log(`Starting scrape for config: ${configName}`);

  // Run in background (don't await)
  (async () => {
    try {
      const manifest = await resolveManifest(configPath);
      await downloadFromManifest(manifest);
      console.log(`Successfully scraped ${configName}`);
    } catch (err) {
      console.error(`Error scraping ${configName}:`, err);
    }
  })();

  return c.json({
    message: `Scraping with config ${configName} started in background. This may take a few minutes.`,
    status: "processing",
  });
});

// Discover new catalogs
app.post("/api/discover", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const autoScrape = body?.autoScrape === true;
    const report = await discoverAll({ autoScrape });
    return c.json(report);
  } catch (err) {
    console.error("[discover] error:", err);
    return c.json({ error: "Discovery failed" }, 500);
  }
});

// List available store configs
app.get("/api/stores", async (c) => {
  try {
    const files = await readdir("configs");
    const configs = files.filter((f) => f.endsWith(".json"));
    return c.json({ configs });
  } catch {
    return c.json({ configs: [] });
  }
});

// --- Static file serving ---

// Serve newsletter images
app.use("/newsletters/*", serveStatic({ root: "./" }));

// Serve frontend
app.use("/*", serveStatic({ root: "./frontend" }));

// --- Helpers ---

function manifestToSummary(manifest: Manifest) {
  const { validFrom, validUntil } = parseDatesFromId(manifest.id);
  return {
    id: manifest.id,
    store: manifest.store,
    title: manifest.id,
    coverImage: `/newsletters/${manifest.id}/cover-image.jpg`,
    validFrom,
    validUntil,
  };
}

function manifestToDetail(manifest: Manifest) {
  const summary = manifestToSummary(manifest);
  return {
    ...summary,
    pages: manifest.pages.map((p) => ({
      pageNumber: p.number,
      imageUrl: `/newsletters/${manifest.id}/pages/page-${String(p.number).padStart(3, "0")}.jpg`,
    })),
  };
}

function directoryToSummary(dirName: string) {
  const store = dirName.includes("-")
    ? dirName.slice(0, dirName.indexOf("-"))
    : dirName;
  const { validFrom, validUntil } = parseDatesFromId(dirName);
  return {
    id: dirName,
    store,
    title: dirName,
    coverImage: `/newsletters/${dirName}/cover-image.jpg`,
    validFrom,
    validUntil,
  };
}

// Parse "lidl-09-02-15-02-2026" -> { validFrom: "09-02", validUntil: "15-02-2026" }
export function parseDatesFromId(id: string): {
  validFrom: string;
  validUntil: string;
} {
  const match = id.match(/\d{2}-\d{2}-\d{2}-\d{2}-\d{4}$/);
  if (match) {
    const dateStr = match[0]; // "09-02-15-02-2026"
    const validFrom = dateStr.slice(0, 5); // "09-02"
    const validUntil = dateStr.slice(6); // "15-02-2026"
    return { validFrom, validUntil };
  }
  return { validFrom: "", validUntil: "" };
}

// --- Start server ---

const port = 8080;
console.log(`Server starting on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
