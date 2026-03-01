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

Options:
  --country=NAME       Filter by country folder name (e.g., romania, germany)
  --store=NAME         Filter by store name (e.g., lidl, kaufland)
  --discover-only      Only run discovery, skip scraping
  --data-dir=PATH      Data directory (default: ../../data/catalogs)
  -h, --help           Show this help
`);
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
