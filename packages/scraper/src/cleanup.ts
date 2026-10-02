import { R2StorageAdapter } from "./storage/r2-adapter.ts";
import { createLogger } from "./logger.ts";
import { findBogus, deleteAll } from "./cleanup-core.ts";
import { mapWithConcurrency } from "./utils/concurrency.ts";

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

const DELETE_CONCURRENCY = 8;
const WRITE_CONCURRENCY = 8;
// Stop starting new deletions after this budget so manifests are still
// regenerated before the workflow timeout; leftovers are picked up next run.
const DELETE_BUDGET_MS = Number(process.env.CLEANUP_DELETE_BUDGET_MS ?? 20 * 60 * 1000);
const startedAt = Date.now();

// One bucket listing for the whole run (previously one full listing per status).
const metas = await storage.listAllCatalogMetas();
log.info(`loaded ${metas.length} catalog meta(s)`);

// --- Phase 0: mark catalogs with bogus dates as failed ---
// Runs first and is cheap (meta already loaded, only PUTs), so it always
// completes even if deletion is slow.

const bogus = findBogus(metas);
await mapWithConcurrency(bogus, WRITE_CONCURRENCY, async ({ meta, reason }) => {
  try {
    await storage.writeCatalogMeta({ ...meta, status: "failed" });
    meta.status = "failed"; // reflect in-memory so Phase 1 deletes it
    log.warn(`marked bogus as failed: ${meta.id} — ${reason}`);
  } catch (err) {
    log.error(`failed to mark ${meta.id}`, { err: String(err) });
  }
});

if (bogus.length > 0) {
  log.info(`marked ${bogus.length} catalog(s) with bogus dates as failed`);
}

// --- Phase 1: delete expired + failed catalogs ---

const toDelete = metas.filter((m) => m.status === "expired" || m.status === "failed");

if (toDelete.length === 0) {
  log.info("nothing to delete");
  process.exit(0);
}

log.info(`found ${toDelete.length} expired/failed catalog(s)`);

const byId = new Map(toDelete.map((m) => [m.id, m]));
const outcome = await deleteAll(
  toDelete.map((m) => m.id),
  async (id) => {
    try {
      await storage.deleteCatalog(id);
      log.info(`deleted ${id}`);
    } catch (err) {
      log.error(`failed to delete ${id}`, { err: String(err) });
      throw err;
    }
  },
  { concurrency: DELETE_CONCURRENCY, deadline: startedAt + DELETE_BUDGET_MS }
);

log.info(
  `done: ${outcome.deleted.length}/${toDelete.length} deleted, ${outcome.failed.length} failed, ${outcome.skipped.length} deferred to next run`
);

// Regenerate per-country manifests for affected countries
if (outcome.deleted.length > 0) {
  const { generateManifest } = await import("./pipeline.ts");
  // Single unscoped call rewrites every per-country manifest and the root one
  // (country-scoped calls no longer touch the root manifest).
  await generateManifest(storage);
}
