import { chromium } from "../browser.ts";
import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "shopfully" });

const PDFJS_VERSION = "4.7.76";
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

/**
 * Shopfully Cloud resolver.
 *
 * Shopfully catalogs are stored as PDFs on it-it-media-publications.shopfully.cloud
 * (or equivalent regional CDNs). The firstPageUrl stored in catalog meta is the
 * direct PDF URL from the flyer's lastPubblication.pdf_url field.
 *
 * This resolver downloads the PDF and renders it to JPEG images via pdf.js in
 * a headless browser, identical to the existing PDF resolver but scoped to the
 * Shopfully CDN domain for auto-detection purposes.
 */

/**
 * Render all pages of a PDF to JPEG buffers using Playwright + pdf.js.
 * Downloads the PDF server-side first to avoid CORS issues.
 */
async function renderShopfullyPdf(pdfUrl: string): Promise<Buffer[]> {
  log.info(`downloading ${pdfUrl}`);
  const resp = await fetch(pdfUrl);
  if (!resp.ok) {
    throw new Error(`Shopfully PDF download failed: ${resp.status} ${resp.statusText}`);
  }
  const pdfBuffer = Buffer.from(await resp.arrayBuffer());
  const pdfBase64 = pdfBuffer.toString("base64");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    // Navigate to a real page so dynamic import works
    await page.goto(`${PDFJS_CDN}/pdf.min.mjs`);
    await page.setContent(
      `<!DOCTYPE html><html><body><canvas id="canvas"></canvas></body></html>`
    );

    // Add pdf.js as a module script that assigns to window
    await page.addScriptTag({
      content: `
        import * as pdfjsLib from "${PDFJS_CDN}/pdf.min.mjs";
        pdfjsLib.GlobalWorkerOptions.workerSrc = "${PDFJS_CDN}/pdf.worker.min.mjs";
        window.__pdfjsLib = pdfjsLib;
      `,
      type: "module",
    });

    // Wait for pdf.js to load
    await page.waitForFunction(() => (window as any).__pdfjsLib, null, {
      timeout: 15000,
    });

    // Render all pages
    const dataUrls: string[] = await page.evaluate(async (base64: string) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const pdfjsLib = (window as any).__pdfjsLib;
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const results: string[] = [];
      const canvas = document.getElementById("canvas") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;

      for (let i = 1; i <= pdf.numPages; i++) {
        const pdfPage = await pdf.getPage(i);
        const viewport = pdfPage.getViewport({ scale: 2.0 });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        results.push(canvas.toDataURL("image/jpeg", 0.85));
      }

      return results;
    }, pdfBase64);

    return dataUrls.map((dataUrl) => {
      const base64 = dataUrl.split(",")[1]!;
      return Buffer.from(base64, "base64");
    });
  } finally {
    await browser.close();
  }
}

async function resolveViaShopfully(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  log.info(`rendering ${firstPageUrl}`);

  const imageBuffers = await renderShopfullyPdf(firstPageUrl);

  if (imageBuffers.length === 0) {
    throw new Error(`Shopfully PDF rendered no pages: ${firstPageUrl}`);
  }

  log.info(`rendered ${imageBuffers.length} pages`, { catalogId });

  const pages: ResolvedPage[] = imageBuffers.map((data, i) => ({
    number: i + 1,
    imageUrl: firstPageUrl, // placeholder — imageData is used instead
    imageData: data,
  }));

  return {
    catalogId,
    coverImageUrl: firstPageUrl,
    pages,
  };
}

// --- CatalogResolver implementation ---

export const shopfullyResolver: CatalogResolver = {
  name: "shopfully",
  needsLastPage: false,
  resolve: resolveViaShopfully,
};
