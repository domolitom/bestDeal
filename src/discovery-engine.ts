import type { Page } from "playwright";
import type {
  StoreDefinition,
  UrlTransform,
  DatePattern,
  CatalogTypePattern,
} from "./store-config.ts";
import type { DiscoveredCatalog } from "./discoverer.ts";

// --- URL transforms (Node context) ---

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

// --- Date parsing (Node context) ---

export function parseDates(
  text: string,
  patterns: DatePattern[]
): { dateFrom: string; dateTo: string } | null {
  for (const p of patterns) {
    const match = text.match(new RegExp(p.match));
    if (!match) continue;

    const dateFrom = applyGroupRefs(p.dateFrom, match);
    const dateTo = applyGroupRefs(p.dateTo, match);
    return { dateFrom, dateTo };
  }
  return null;
}

function applyGroupRefs(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\d+)/g, (_, idx) => match[parseInt(idx)] || "");
}

// --- Catalog type extraction (Node context) ---

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

// --- Generic store discovery (Playwright context) ---

interface RawLink {
  href: string;
  slug: string;
  dateText: string;
}

export async function discoverStore(
  page: Page,
  storeDef: StoreDefinition
): Promise<DiscoveredCatalog[]> {
  console.log(`[discoverer] discovering ${storeDef.name} catalogs...`);
  await page.goto(storeDef.landingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(storeDef.waitAfterLoad);

  // Serialize patterns for browser context (RegExp isn't transferable)
  const serializedPatterns = storeDef.linkPatterns.map((lp) => ({
    match: lp.match,
    slugGroup: lp.slugGroup,
  }));
  const linkDomain = storeDef.linkDomain || null;

  const rawLinks: RawLink[] = await page.evaluate(
    ({ patterns, domain }) => {
      const links = Array.from(document.querySelectorAll("a[href]"));
      const results: { href: string; slug: string; dateText: string }[] = [];

      for (const link of links) {
        const href = (link as HTMLAnchorElement).href;

        // If a domain filter is set, only consider links matching that domain
        if (domain && !href.includes(domain)) continue;

        for (const pat of patterns) {
          const re = new RegExp(pat.match);
          const m = href.match(re);
          if (!m) continue;

          const slug = pat.slugGroup === 0 ? href : (m[pat.slugGroup] || href);

          // Deduplicate by slug
          if (results.some((r) => r.slug === slug)) break;

          const card =
            link.closest("[class*='card']") || link.parentElement;
          const dateText = card?.textContent || "";

          results.push({ href, slug, dateText });
          break; // First matching pattern wins
        }
      }
      return results;
    },
    { patterns: serializedPatterns, domain: linkDomain }
  );

  // Process in Node context: normalize URLs, parse dates, extract types
  const discovered: DiscoveredCatalog[] = [];
  for (const raw of rawLinks) {
    // Find which pattern matched to get its normalizeUrl transforms
    let firstPageUrl = raw.href;
    for (const lp of storeDef.linkPatterns) {
      if (new RegExp(lp.match).test(raw.href)) {
        firstPageUrl = applyUrlTransforms(raw.href, lp.normalizeUrl);
        break;
      }
    }

    // Parse dates based on dateSource strategy
    let dates: { dateFrom: string; dateTo: string } | null = null;
    if (storeDef.dateSource === "slug" || storeDef.dateSource === "slug_then_text") {
      dates = parseDates(raw.slug, storeDef.datePatterns);
    }
    if (!dates && (storeDef.dateSource === "text" || storeDef.dateSource === "slug_then_text")) {
      dates = parseDates(raw.dateText, storeDef.datePatterns);
    }

    if (!dates) {
      console.log(`[discoverer] skipping ${storeDef.name} catalog (no dates found): slug=${raw.slug}`);
      continue;
    }

    const catalogType = extractCatalogType(raw.href, storeDef.catalogTypePattern);

    discovered.push({
      store: storeDef.name,
      slug: raw.slug,
      dateFrom: dates.dateFrom,
      dateTo: dates.dateTo,
      firstPageUrl,
      coverImageUrl: firstPageUrl,
      catalogType: catalogType || undefined,
    });
  }

  console.log(`[discoverer] found ${discovered.length} ${storeDef.name} catalog(s)`);
  return discovered;
}
