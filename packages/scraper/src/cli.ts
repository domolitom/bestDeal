import { parseArgs } from "node:util";
import { join } from "node:path";
import { appendFileSync } from "node:fs";
import type { StorageAdapter } from "@bestdeal/shared";
import { FilesystemAdapter } from "./storage/fs-adapter.ts";
import { runPipeline, generateManifest } from "./pipeline.ts";
import type { PipelineReport } from "./pipeline.ts";
import { createLogger } from "./logger.ts";

const log = createLogger({ module: "cli" });

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    country: { type: "string" },
    store: { type: "string" },
    "discover-only": { type: "boolean", default: false },
    "manifest-only": { type: "boolean", default: false },
    "auto-discover": { type: "boolean", default: false },
    url: { type: "string" },
    "data-dir": { type: "string", default: "../../data/catalogs" },
    storage: { type: "string", default: "fs" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
bestDeal Scraper Pipeline

Usage:
  bun run scraper                          Full pipeline (all countries, all stores)
  bun run scraper --country=romania        Limit to one country
  bun run scraper --store=lidl --country=romania
  bun run scraper --discover-only          Only discover, don't scrape
  bun run scraper --manifest-only          Regenerate root manifest.json from all ready catalogs

  bun run scraper --auto-discover --url=URL --store=NAME --country=NAME
    Generate a store config from a landing URL using an LLM.
    Requires OPENAI_API_KEY environment variable.

Options:
  --country=NAME       Filter by country folder name (e.g., romania, germany)
  --store=NAME         Filter by store name (e.g., lidl, kaufland)
  --discover-only      Only run discovery, skip scraping
  --manifest-only      Regenerate manifest.json only, skip all scraping
  --auto-discover      Generate a store config from a landing URL
  --url=URL            Landing URL (required with --auto-discover)
  --data-dir=PATH      Data directory (default: ../../data/catalogs)
  --storage=TYPE       Storage backend: fs (default) or r2
                       R2 requires env vars: R2_ENDPOINT, R2_BUCKET,
                       R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL
  -h, --help           Show this help
`);
  process.exit(0);
}

if (values["auto-discover"]) {
  const url = values.url;
  const store = values.store;
  const country = values.country;

  if (!url || !store || !country) {
    log.error("--auto-discover requires --url, --store, and --country");
    process.exit(1);
  }

  const { runAutoDiscover } = await import("./auto-discover/index.ts");

  try {
    const configPath = await runAutoDiscover({ url, store, country });
    log.info(`config written to: ${configPath}`);
  } catch (err) {
    log.error("auto-discover failed", { err: String(err) });
    process.exit(1);
  }

  process.exit(0);
}

async function createStorage(): Promise<StorageAdapter> {
  if (values.storage === "r2") {
    const { R2StorageAdapter } = await import("./storage/r2-adapter.ts");

    const endpoint = process.env.R2_ENDPOINT;
    const bucket = process.env.R2_BUCKET ?? "bestdeal-catalogs";
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!endpoint || !accessKeyId || !secretAccessKey || !publicUrl) {
      log.error("--storage=r2 requires env vars: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL");
      process.exit(1);
    }

    log.info(`using R2 storage`, { bucket });
    return new R2StorageAdapter({
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      publicUrl,
    });
  }

  const dataDir = join(
    import.meta.dir,
    values["data-dir"] ?? "../../data/catalogs"
  );
  log.info(`data directory: ${dataDir}`);
  return new FilesystemAdapter(dataDir);
}

const storage = await createStorage();

// Single wall-clock read for this process. Threaded through the pipeline so
// discovery/manifest logic never calls `new Date()` internally, making it
// deterministic and testable — see runPipeline/discoverAll `now` params.
const now = new Date();

// --manifest-only: regenerate the root manifest.json from all ready catalogs
// without running discovery or scraping. Used by the CI finalize job.
if (values["manifest-only"]) {
  log.info("manifest-only mode: regenerating manifest.json");
  try {
    await generateManifest(storage, undefined, now);
    log.info("manifest regenerated");
  } catch (err) {
    log.error("manifest regeneration failed", { err: String(err) });
    process.exit(1);
  }
  process.exit(0);
}

log.info("starting pipeline", {
  country: values.country ?? "all",
  store: values.store ?? "all",
  mode: values["discover-only"] ? "discover-only" : "full pipeline",
});

/**
 * Write a Markdown summary to $GITHUB_STEP_SUMMARY so it appears in the
 * GitHub Actions run UI. Only called when that env var is set (i.e. in CI).
 */
function writeStepSummary(report: PipelineReport, country: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const { discovery, scraped, failed, recovered } = report;
  const countryLabel = country.charAt(0).toUpperCase() + country.slice(1);
  const discovered = discovery.summary.new;
  const existing = discovery.summary.existing;
  const total = discovery.summary.total;

  const lines: string[] = [];

  lines.push(`## ${countryLabel} scrape results`);
  lines.push("");
  lines.push(
    `Discovered **${total}** catalog(s) — ${discovered} new, ${existing} existing. ` +
    `Scraped **${scraped.length}**, failed **${failed.length}**.`
  );
  lines.push("");

  // Per-store table
  lines.push("| Store | Discovered | Scraped | Failed | Status |");
  lines.push("|-------|-----------|---------|--------|--------|");

  for (const s of discovery.stores) {
    const storeNew = s.catalogs.filter((c) => c.status === "new").length;
    const storeCatalogIds = s.catalogs.map((c) => c.catalogId);
    const storeScraped = scraped.filter((id) => storeCatalogIds.includes(id)).length;
    const storeFailed = failed.filter((id) => storeCatalogIds.includes(id)).length;
    const statusIcon =
      storeFailed > 0 ? "FAIL" : storeScraped > 0 ? "OK" : storeNew === 0 ? "--" : "OK";
    lines.push(
      `| ${s.store} | ${storeNew} | ${storeScraped} | ${storeFailed} | ${statusIcon} |`
    );
  }

  if (recovered.length > 0) {
    lines.push("");
    lines.push(`**Recovered ${recovered.length} stale catalog(s):**`);
    for (const id of recovered) {
      lines.push(`- ${id}`);
    }
  }

  if (failed.length > 0) {
    lines.push("");
    lines.push("**Failed catalogs:**");
    for (const id of failed) {
      lines.push(`- ${id}`);
    }
  }

  lines.push("");

  try {
    appendFileSync(summaryPath, lines.join("\n"));
  } catch (err) {
    log.warn("could not write step summary", { err: String(err) });
  }
}

try {
  const report = await runPipeline({
    storage,
    country: values.country,
    store: values.store,
    discoverOnly: values["discover-only"],
    now,
  });

  writeStepSummary(report, values.country ?? "all");
  console.log("\n" + JSON.stringify(report, null, 2));
} catch (err) {
  log.error("fatal", { err: String(err) });
  process.exit(1);
}
