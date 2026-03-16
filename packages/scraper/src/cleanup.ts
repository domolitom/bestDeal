import { R2StorageAdapter } from "./storage/r2-adapter.ts";
import { createLogger } from "./logger.ts";

const log = createLogger({ module: "cleanup" });

const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET ?? "bestdeal-catalogs";
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const publicUrl = process.env.R2_PUBLIC_URL;

if (!endpoint || !accessKeyId || !secretAccessKey || !publicUrl) {
  log.error("requires env vars: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL");
  process.exit(1);
}

const storage = new R2StorageAdapter({
  endpoint,
  bucket,
  accessKeyId,
  secretAccessKey,
  publicUrl,
});

const expired = await storage.listCatalogs({ status: "expired" });
const failed = await storage.listCatalogs({ status: "failed" });
const toDelete = [...expired, ...failed];

if (toDelete.length === 0) {
  log.info("nothing to delete");
  process.exit(0);
}

log.info(`found ${expired.length} expired + ${failed.length} failed catalog(s)`);

let deleted = 0;
for (const catalog of toDelete) {
  try {
    await storage.deleteCatalog(catalog.id);
    deleted++;
    log.info(`deleted ${catalog.id}`);
  } catch (err) {
    log.error(`failed to delete ${catalog.id}`, { err: String(err) });
  }
}

log.info(`done: ${deleted}/${toDelete.length} deleted`);

// Regenerate per-country manifests for affected countries
if (deleted > 0) {
  const { generateManifest } = await import("./pipeline.ts");
  const affectedCountries = new Set(toDelete.map((c) => c.country));
  for (const country of affectedCountries) {
    await generateManifest(storage, country);
  }
}
