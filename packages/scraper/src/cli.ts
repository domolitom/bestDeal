import { parseArgs } from "node:util";
import { join } from "node:path";
import type { StorageAdapter } from "@bestdeal/shared";
import { FilesystemAdapter } from "./storage/fs-adapter.ts";
import { runPipeline } from "./pipeline.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    country: { type: "string" },
    store: { type: "string" },
    "discover-only": { type: "boolean", default: false },
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

  bun run scraper --auto-discover --url=URL --store=NAME --country=NAME
    Generate a store config from a landing URL using an LLM.
    Requires OPENAI_API_KEY environment variable.

Options:
  --country=NAME       Filter by country folder name (e.g., romania, germany)
  --store=NAME         Filter by store name (e.g., lidl, kaufland)
  --discover-only      Only run discovery, skip scraping
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
    console.error(
      "[cli] --auto-discover requires --url, --store, and --country"
    );
    process.exit(1);
  }

  const { runAutoDiscover } = await import("./auto-discover/index.ts");

  try {
    const configPath = await runAutoDiscover({ url, store, country });
    console.log(`\nConfig written to: ${configPath}`);
  } catch (err) {
    console.error("[cli] auto-discover failed:", err);
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
      console.error(
        "[cli] --storage=r2 requires env vars: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL"
      );
      process.exit(1);
    }

    console.log(`[cli] using R2 storage (bucket: ${bucket})`);
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
  console.log(`[cli] data directory: ${dataDir}`);
  return new FilesystemAdapter(dataDir);
}

const storage = await createStorage();

console.log(
  `[cli] filters: country=${values.country ?? "all"}, store=${values.store ?? "all"}`
);
console.log(
  `[cli] mode: ${values["discover-only"] ? "discover-only" : "full pipeline"}`
);

try {
  const report = await runPipeline({
    storage,
    country: values.country,
    store: values.store,
    discoverOnly: values["discover-only"],
  });

  console.log("\n" + JSON.stringify(report, null, 2));
} catch (err) {
  console.error("[cli] fatal:", err);
  process.exit(1);
}
