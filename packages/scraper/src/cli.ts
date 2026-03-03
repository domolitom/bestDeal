import { parseArgs } from "node:util";
import { join } from "node:path";
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

const dataDir = join(import.meta.dir, values["data-dir"] ?? "../../data/catalogs");
const storage = new FilesystemAdapter(dataDir);

console.log(`[cli] data directory: ${dataDir}`);
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
