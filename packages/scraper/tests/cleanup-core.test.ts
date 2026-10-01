import { describe, expect, test } from "bun:test";
import { findBogus, deleteAll } from "../src/cleanup-core.ts";
import { mapWithConcurrency } from "../src/utils/concurrency.ts";
import type { CatalogMeta } from "@bestdeal/shared";

const meta = (id: string, status: string, dateFrom: string, dateTo: string) =>
  ({ id, status, dateFrom, dateTo }) as unknown as CatalogMeta;

describe("mapWithConcurrency", () => {
  test("preserves order and respects limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const res = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(res).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });
  test("empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("findBogus", () => {
  test("flags unparseable dates only for live statuses", () => {
    const r = findBogus([
      meta("a", "ready", "nope", "2030-01-01"),
      meta("b", "failed", "nope", "2030-01-01"),
      meta("c", "expired", "nope", "2030-01-01"),
    ]);
    expect(r.map((x) => x.meta.id)).toEqual(["a"]);
  });
});

describe("deleteAll", () => {
  test("collects deleted and failed, continuing past errors", async () => {
    const out = await deleteAll(["a", "b", "c"], async (id) => {
      if (id === "b") throw new Error("boom");
    }, { concurrency: 2, deadline: Infinity });
    expect(out.deleted.sort()).toEqual(["a", "c"]);
    expect(out.failed).toEqual(["b"]);
    expect(out.skipped).toEqual([]);
  });
  test("skips remaining work after deadline", async () => {
    const out = await deleteAll(["a", "b", "c"], async () => {}, {
      concurrency: 1,
      deadline: 100,
      now: () => 200,
    });
    expect(out.skipped).toEqual(["a", "b", "c"]);
    expect(out.deleted).toEqual([]);
  });
});
