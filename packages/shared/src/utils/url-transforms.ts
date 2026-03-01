import type { UrlTransform, CatalogTypePattern } from "../types/store";

/**
 * Apply a chain of URL transforms (replace, append, conditional).
 */
export function applyUrlTransforms(url: string, transforms: UrlTransform[]): string {
  let result = url;
  for (const t of transforms) {
    if (t.type === "replace") {
      result = result.replace(new RegExp(t.match), t.replacement);
    } else if (t.type === "append") {
      result = result + t.suffix;
    } else if (t.type === "else") {
      if (result.includes(t.condition)) {
        result = result.replace(new RegExp(t.ifTrue.match), t.ifTrue.replacement);
      } else {
        result = result.replace(new RegExp(t.ifFalse.match), t.ifFalse.replacement);
      }
    }
  }
  return result;
}

/**
 * Extract catalog type from a URL using a regex pattern.
 */
export function extractCatalogType(
  url: string,
  pattern: CatalogTypePattern | undefined
): string | null {
  if (!pattern) return null;
  const flags = pattern.caseInsensitive ? "i" : "";
  const match = url.match(new RegExp(pattern.match, flags));
  if (!match || !match[1]) return null;
  let result = match[1];
  if (pattern.transform === "lowercase") result = result.toLowerCase();
  if (pattern.transform === "uppercase") result = result.toUpperCase();
  return result;
}

/**
 * Extract page number from a /page/N URL.
 */
export function extractPageNumber(url: string): number {
  const match = url.match(/\/page\/(\d+)/);
  if (!match) throw new Error(`Page number not found in URL: ${url}`);
  return parseInt(match[1]!, 10);
}

/**
 * Replace the page number in a /page/N URL.
 */
export function buildPageURL(templateURL: string, pageNum: number): string {
  return templateURL.replace(/\/page\/\d+/, `/page/${pageNum}`);
}
