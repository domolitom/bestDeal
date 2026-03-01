import type { Page } from "playwright";
import type { StoreDefinition } from "@bestdeal/shared";
import { applyUrlTransforms, parseDates, extractCatalogType } from "@bestdeal/shared";

export interface DiscoveredCatalog {
  store: string;
  country: string;
  slug: string;
  dateFrom: string; // raw format from pattern, e.g. "09-02"
  dateTo: string; // raw format from pattern, e.g. "15-02-2026"
  firstPageUrl: string;
  coverImageUrl: string;
  catalogType?: string;
}

interface RawLink {
  href: string;
  slug: string;
  dateText: string;
}

/**
 * Discover catalogs from a store's landing page using Playwright.
 */
export async function discoverStore(
  page: Page,
  storeDef: StoreDefinition
): Promise<DiscoveredCatalog[]> {
  console.log(`[discovery] discovering ${storeDef.name} catalogs...`);
  await page.goto(storeDef.landingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(storeDef.waitAfterLoad);

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

        if (domain && !href.includes(domain)) continue;

        for (const pat of patterns) {
          const re = new RegExp(pat.match);
          const m = href.match(re);
          if (!m) continue;

          const slug =
            pat.slugGroup === 0 ? href : (m[pat.slugGroup] || href);

          if (results.some((r) => r.slug === slug)) break;

          let dateText = "";
          let el: Element | null =
            link.closest("[class*='card']") || (link as Element);
          for (let i = 0; i < 5 && el; i++) {
            const text = (el.textContent || "").trim();
            if (text) {
              dateText = text;
              break;
            }
            el = el.parentElement;
          }

          results.push({ href, slug, dateText });
          break;
        }
      }
      return results;
    },
    { patterns: serializedPatterns, domain: linkDomain }
  );

  const discovered: DiscoveredCatalog[] = [];
  for (const raw of rawLinks) {
    let firstPageUrl = raw.href;
    for (const lp of storeDef.linkPatterns) {
      if (new RegExp(lp.match).test(raw.href)) {
        firstPageUrl = applyUrlTransforms(raw.href, lp.normalizeUrl);
        break;
      }
    }

    let dates: { dateFrom: string; dateTo: string } | null = null;
    if (
      storeDef.dateSource === "slug" ||
      storeDef.dateSource === "slug_then_text"
    ) {
      dates = parseDates(raw.slug, storeDef.datePatterns);
    }
    if (
      !dates &&
      (storeDef.dateSource === "text" ||
        storeDef.dateSource === "slug_then_text")
    ) {
      dates = parseDates(raw.dateText, storeDef.datePatterns);
    }

    if (!dates) {
      console.log(
        `[discovery] skipping ${storeDef.name} catalog (no dates): slug=${raw.slug}`
      );
      continue;
    }

    const catalogType = extractCatalogType(
      raw.href,
      storeDef.catalogTypePattern
    );

    discovered.push({
      store: storeDef.name,
      country: storeDef.country,
      slug: raw.slug,
      dateFrom: dates.dateFrom,
      dateTo: dates.dateTo,
      firstPageUrl,
      coverImageUrl: firstPageUrl,
      catalogType: catalogType || undefined,
    });
  }

  console.log(
    `[discovery] found ${discovered.length} ${storeDef.name} catalog(s)`
  );
  return discovered;
}
