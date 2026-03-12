import type { ResolveResult, ResolvedPage } from "./resolver-types.ts";
import type { CatalogResolver, ResolveInput } from "./resolver-registry.ts";
import { registerResolver } from "./resolver-registry.ts";

interface YumpuPage {
  nr: number;
  images: Record<string, string>;
  qss: Record<string, string>;
}

interface YumpuDocument {
  base_path: string;
  pages: YumpuPage[];
  pages_count: number;
}

/** Preferred image size (large ≈ 1132×1600). */
const PREFERRED_SIZE = "large";
const FALLBACK_SIZES = ["medium", "small", "thumb"] as const;

/**
 * Extract the Yumpu document ID from a URL.
 * e.g. "https://www.yumpu.com/ro/document/read/67944690/slug" → "67944690"
 */
export function extractYumpuDocId(url: string): string | null {
  const match = url.match(/yumpu\.com\/\w+\/document\/(?:read|view|json)\/(\d+)/);
  return match?.[1] ?? null;
}

/**
 * Extract the language segment from a Yumpu URL.
 * e.g. "https://www.yumpu.com/ro/document/read/123/slug" → "ro"
 */
function extractLang(url: string): string {
  const match = url.match(/yumpu\.com\/(\w+)\/document/);
  return match?.[1] ?? "en";
}

async function resolveViaYumpuApi(
  input: ResolveInput
): Promise<ResolveResult> {
  const { firstPageUrl, catalogId } = input;

  const docId = extractYumpuDocId(firstPageUrl);
  if (!docId) {
    throw new Error(
      `Could not extract Yumpu document ID from: ${firstPageUrl}`
    );
  }

  const lang = extractLang(firstPageUrl);
  const apiUrl = `https://www.yumpu.com/${lang}/document/json/${docId}`;
  console.log(`[yumpu-api] fetching ${apiUrl}`);

  const resp = await fetch(apiUrl);
  if (!resp.ok) {
    throw new Error(
      `Yumpu API returned ${resp.status}: ${resp.statusText}`
    );
  }

  const data = await resp.json();
  const doc: YumpuDocument = data.document;

  if (!doc?.pages?.length) {
    throw new Error(`Yumpu API returned no pages for doc: ${docId}`);
  }

  const basePath = doc.base_path;
  const pages: ResolvedPage[] = [];

  for (const page of doc.pages) {
    const size =
      PREFERRED_SIZE in page.images
        ? PREFERRED_SIZE
        : FALLBACK_SIZES.find((s) => s in page.images);

    if (!size) continue;

    const imagePath = page.images[size]!;
    const qs = page.qss[size] ?? "";
    const imageUrl = qs
      ? `${basePath}${imagePath}?${qs}`
      : `${basePath}${imagePath}`;

    pages.push({ number: page.nr, imageUrl });
  }

  console.log(
    `[yumpu-api] got ${pages.length} pages for ${catalogId}`
  );

  return {
    catalogId,
    coverImageUrl: pages[0]?.imageUrl ?? "",
    pages,
  };
}

// --- CatalogResolver implementation ---

const yumpuResolver: CatalogResolver = {
  name: "yumpu",
  needsLastPage: false,
  resolve: resolveViaYumpuApi,
};

registerResolver(yumpuResolver);
