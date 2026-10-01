import type { CatalogMeta } from "@bestdeal/shared";
import { hasBogusDate } from "./utils/bogus-date.ts";
import { mapWithConcurrency } from "./utils/concurrency.ts";

/** Metas in ready/discovered/scraping state that have bogus dates, with reason. */
export function findBogus(
  metas: readonly CatalogMeta[]
): Array<{ meta: CatalogMeta; reason: string }> {
  const out: Array<{ meta: CatalogMeta; reason: string }> = [];
  for (const meta of metas) {
    if (meta.status !== "ready" && meta.status !== "discovered" && meta.status !== "scraping") continue;
    const reason = hasBogusDate(meta.dateFrom, meta.dateTo);
    if (reason) out.push({ meta, reason });
  }
  return out;
}

export interface DeleteOutcome {
  deleted: string[];
  failed: string[];
  skipped: string[];
}

/**
 * Delete catalogs with bounded concurrency. Stops starting new deletions once
 * `deadline` (epoch ms) passes; the remainder is reported as skipped so the
 * caller can still finish follow-up work (manifest regeneration) and the next
 * daily run picks them up.
 */
export async function deleteAll(
  ids: readonly string[],
  deleteOne: (id: string) => Promise<void>,
  opts: { concurrency: number; deadline: number; now?: () => number }
): Promise<DeleteOutcome> {
  const now = opts.now ?? Date.now;
  const out: DeleteOutcome = { deleted: [], failed: [], skipped: [] };
  await mapWithConcurrency(ids, opts.concurrency, async (id) => {
    if (now() >= opts.deadline) {
      out.skipped.push(id);
      return;
    }
    try {
      await deleteOne(id);
      out.deleted.push(id);
    } catch {
      out.failed.push(id);
    }
  });
  return out;
}
