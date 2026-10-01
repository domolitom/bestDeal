import { describe, expect, test, afterEach } from "bun:test";
import { renderPdfPages } from "../src/scraping/pdf-render.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("renderPdfPages", () => {
  test("throws label-prefixed error when download fails", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 404, statusText: "Not Found" })) as unknown as typeof fetch;

    await expect(renderPdfPages("https://example.com/a.pdf", "PDF")).rejects.toThrow(
      "PDF download failed: 404 Not Found",
    );
    await expect(
      renderPdfPages("https://example.com/a.pdf", "Shopfully PDF"),
    ).rejects.toThrow("Shopfully PDF download failed: 404 Not Found");
  });
});
