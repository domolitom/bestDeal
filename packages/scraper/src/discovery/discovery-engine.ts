import type { Page } from "playwright";
import type { StoreDefinition } from "@bestdeal/shared";
import { applyUrlTransforms, parseDates, extractCatalogType } from "@bestdeal/shared";
import { createLogger } from "../logger.ts";
import { extractFlyerSlug, deriveLeafletsApiHost } from "../scraping/leaflets-api-resolver.ts";

const log = createLogger({ module: "discovery" });

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
  /** Overridden firstPageUrl extracted from an iframe on the linked page */
  iframeUrl?: string;
}

interface LeafletsApiFlyer {
  offerStartDate?: string;
  offerEndDate?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
}

/**
 * Fetch date information for a single flyer slug from the Leaflets API.
 *
 * Date field selection:
 *   - Prefers `offerStartDate`/`offerEndDate` which represent the actual offer
 *     validity window (typically the weekly grocery promo period).
 *   - Falls back to `startDate`/`endDate` only when the offer dates are absent.
 *
 * If `allowedCategories` is provided and non-empty, flyers whose `category`
 * is not in that list are skipped (returns null). This prevents travel
 * catalogs ("Lidl Reisen") and special topic flyers ("Sonderflyer") from
 * being ingested as grocery catalogs.
 *
 * Returns ISO-formatted dates or null if the call fails or flyer is filtered.
 */
export async function fetchLeafletsApiDates(
  slug: string,
  apiHost: string,
  allowedCategories?: string[]
): Promise<{ dateFrom: string; dateTo: string } | null> {
  const apiUrl = `https://${apiHost}/v4/flyer?flyer_identifier=${encodeURIComponent(slug)}`;
  try {
    const resp = await fetch(apiUrl);
    if (!resp.ok) {
      log.warn(`Leaflets API ${resp.status} for slug: ${slug}`);
      return null;
    }
    const data = await resp.json();
    const flyer: LeafletsApiFlyer = data.flyer;
    if (!flyer) return null;

    // Category filter: skip non-allowed flyer types when an allowlist is set
    if (allowedCategories && allowedCategories.length > 0) {
      const cat = flyer.category ?? "";
      if (!allowedCategories.includes(cat)) {
        log.info(`skipping flyer "${slug}" (category "${cat}" not in allowlist)`);
        return null;
      }
    }

    const dateFrom = flyer.offerStartDate || flyer.startDate;
    const dateTo = flyer.offerEndDate || flyer.endDate;
    if (!dateFrom || !dateTo) return null;

    return { dateFrom, dateTo };
  } catch (err) {
    log.warn(`Leaflets API error for slug: ${slug}`, { err: String(err) });
    return null;
  }
}

/**
 * Discover catalogs from a store's landing page using Playwright.
 */
export async function discoverStore(
  page: Page,
  storeDef: StoreDefinition
): Promise<DiscoveredCatalog[]> {
  log.info(`discovering ${storeDef.name} catalogs...`);
  await page.goto(storeDef.landingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(storeDef.waitAfterLoad);

  const serializedPatterns = storeDef.linkPatterns.map((lp) => ({
    match: lp.match,
    slugGroup: lp.slugGroup,
  }));
  const linkDomain = storeDef.linkDomain || null;
  const customSelector = storeDef.linkSelector || null;
  const customAttribute = storeDef.linkAttribute || null;

  const rawLinks: RawLink[] = await page.evaluate(
    ({ patterns, domain, customSelector, customAttribute }) => {
      const results: { href: string; slug: string; dateText: string }[] = [];

      // Collect candidate URLs from <a> and <iframe> elements
      const candidates: { href: string; element: Element }[] = [];

      if (customSelector && customAttribute) {
        // Custom selector mode: extract URLs from arbitrary elements
        for (const el of Array.from(document.querySelectorAll(customSelector))) {
          const val = el.getAttribute(customAttribute);
          if (!val) continue;
          // Resolve relative URLs and decode (data attributes often have spaces)
          const raw = val.startsWith("http") ? val : new URL(val, location.origin).href;
          const href = decodeURI(raw);
          candidates.push({ href, element: el });
        }
      } else {
        for (const link of Array.from(document.querySelectorAll("a[href]"))) {
          candidates.push({
            href: (link as HTMLAnchorElement).href,
            element: link,
          });
        }
        for (const iframe of Array.from(
          document.querySelectorAll("iframe[src]")
        )) {
          const src = (iframe as HTMLIFrameElement).src;
          if (src) candidates.push({ href: src, element: iframe });
        }
      }

      for (const { href, element } of candidates) {
        if (domain && !href.includes(domain)) continue;

        for (const pat of patterns) {
          const re = new RegExp(pat.match);
          const m = href.match(re);
          if (!m) continue;

          const slug =
            pat.slugGroup === 0 ? href : (m[pat.slugGroup] || href);

          if (results.some((r) => r.slug === slug)) break;

          let dateText = "";
          const card =
            element.closest("[class*='card']") ||
            element.closest("[class*='item']") ||
            element.closest("[class*='tile']") ||
            element.closest("[class*='brosur']") ||
            element.closest("[class*='leaflet']") ||
            element.closest("[class*='catalog']") ||
            element.closest("[class*='flyer']") ||
            element.closest("[class*='promo']") ||
            element.closest("li") ||
            element.closest("article");
          if (card) {
            dateText = (card.textContent || "").trim();
          } else {
            // Walk up to find the widest reasonable parent text
            let el: Element | null = element;
            for (let i = 0; i < 5 && el; i++) {
              const text = (el.textContent || "").trim();
              if (text && text.length < 2000) {
                dateText = text;
              }
              el = el.parentElement;
            }
          }

          results.push({ href, slug, dateText });
          break;
        }
      }
      return results;
    },
    { patterns: serializedPatterns, domain: linkDomain, customSelector, customAttribute }
  );

  // Visit linked pages if we need text-based dates or iframe URL extraction
  const needsTextDate =
    storeDef.dateSource === "text" || storeDef.dateSource === "slug_then_text";
  const needsPageVisit = needsTextDate || !!storeDef.iframeExtract;
  if (needsPageVisit) {
    for (const raw of rawLinks) {
      const hasDates = raw.dateText && parseDates(raw.dateText, storeDef.datePatterns);
      // Skip if dates are found AND no iframe extraction needed
      if (hasDates && !storeDef.iframeExtract) continue;
      // Skip if dates are found AND iframe already extracted
      if (hasDates && raw.iframeUrl) continue;
      try {
        await page.goto(raw.href, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(storeDef.iframeExtract ? 8000 : 5000);

        // Extract iframe URL if configured
        if (storeDef.iframeExtract) {
          const pattern = storeDef.iframeExtract;
          const iframeSrc = await page.evaluate((pat: string) => {
            for (const iframe of Array.from(document.querySelectorAll("iframe[src]"))) {
              const src = (iframe as HTMLIFrameElement).src;
              if (new RegExp(pat).test(src)) return src;
            }
            return null;
          }, pattern);
          if (iframeSrc) {
            raw.iframeUrl = iframeSrc;
          }
        }

        // Extract dates if still needed
        if (!hasDates && needsTextDate) {
          const meta = await page.evaluate(() => {
            const el = document.querySelector('meta[name="description"]');
            return el ? el.getAttribute("content") || "" : "";
          });
          if (meta && parseDates(meta, storeDef.datePatterns)) {
            raw.dateText = meta;
          } else {
            const html = await page.content();
            raw.dateText = html.slice(0, 50000);
          }
        }
      } catch (err) {
        log.warn(`failed to visit ${raw.href}`, { err: String(err) });
      }
    }
    // Navigate back so the page state is clean
    await page.goto(storeDef.landingUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(storeDef.waitAfterLoad);
  }

  // For leaflets_api dateSource, derive the API host from the landing URL
  const leafletsApiHost =
    storeDef.dateSource === "leaflets_api"
      ? deriveLeafletsApiHost(storeDef.landingUrl)
      : null;

  const discovered: DiscoveredCatalog[] = [];
  for (const raw of rawLinks) {
    let firstPageUrl = raw.iframeUrl || raw.href;
    if (!raw.iframeUrl) {
      for (const lp of storeDef.linkPatterns) {
        if (new RegExp(lp.match).test(raw.href)) {
          firstPageUrl = applyUrlTransforms(raw.href, lp.normalizeUrl);
          break;
        }
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
    if (!dates && storeDef.dateSource === "leaflets_api" && leafletsApiHost) {
      // Use the slug as the flyer identifier to fetch dates from the Leaflets API.
      // The slug is extracted from the link pattern (slugGroup) — it is the flyer identifier.
      dates = await fetchLeafletsApiDates(raw.slug, leafletsApiHost, storeDef.leafletsAllowedCategories);
    }

    if (!dates) {
      log.info(`skipping ${storeDef.name} catalog (no dates)`, { slug: raw.slug });
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

  log.info(`found ${discovered.length} ${storeDef.name} catalog(s)`);
  return discovered;
}

/**
 * Discover catalogs via API-based discovery.
 * Extracts catalog IDs from DOM data attributes, then fetches
 * catalog metadata from an API endpoint.
 */
export async function discoverStoreViaApi(
  page: Page,
  storeDef: StoreDefinition
): Promise<DiscoveredCatalog[]> {
  const api = storeDef.apiDiscovery!;
  log.info(`discovering ${storeDef.name} catalogs via API...`);

  await page.goto(storeDef.landingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(storeDef.waitAfterLoad);

  // Extract catalog IDs from DOM
  const catalogIds: string[] = await page.evaluate(
    ({ selector, idAttribute }) => {
      const els = document.querySelectorAll(selector);
      const ids = new Set<string>();
      for (const el of Array.from(els)) {
        const id = el.getAttribute(idAttribute);
        if (id) ids.add(id);
      }
      return [...ids];
    },
    { selector: api.selector, idAttribute: api.idAttribute }
  );

  if (catalogIds.length === 0) {
    log.info(`no catalog IDs found for ${storeDef.name}`);
    return [];
  }

  log.info(`found ${catalogIds.length} catalog ID(s) for ${storeDef.name}`);

  const discovered: DiscoveredCatalog[] = [];

  for (const id of catalogIds) {
    const apiUrl = api.apiUrl.replace("{id}", id);
    try {
      const resp = await fetch(apiUrl);
      if (!resp.ok) {
        log.info(`API ${resp.status} for ${storeDef.name} catalog ${id}`);
        continue;
      }

      const data = await resp.json();

      const firstPageUrl = data[api.fieldMap.firstPageUrl];
      const rawDateFrom = data[api.fieldMap.dateFrom];
      const rawDateTo = data[api.fieldMap.dateTo];

      if (!firstPageUrl || !rawDateFrom || !rawDateTo) {
        log.info(`skipping ${storeDef.name} catalog ${id} (missing fields)`);
        continue;
      }

      // Parse dates through datePatterns if available, otherwise use raw
      let dateFrom = rawDateFrom;
      let dateTo = rawDateTo;
      if (storeDef.datePatterns?.length) {
        const parsedFrom = parseDates(rawDateFrom, storeDef.datePatterns);
        const parsedTo = parseDates(rawDateTo, storeDef.datePatterns);
        if (parsedFrom) dateFrom = parsedFrom.dateFrom;
        if (parsedTo) dateTo = parsedTo.dateTo;
      }

      const coverImageUrl = api.fieldMap.coverImageUrl
        ? data[api.fieldMap.coverImageUrl] || firstPageUrl
        : firstPageUrl;

      const catalogType = api.fieldMap.catalogType
        ? data[api.fieldMap.catalogType]
        : undefined;

      discovered.push({
        store: storeDef.name,
        country: storeDef.country,
        slug: id,
        dateFrom,
        dateTo,
        firstPageUrl,
        coverImageUrl,
        catalogType: catalogType || undefined,
      });
    } catch (err) {
      log.warn(`API error for ${storeDef.name} catalog ${id}`, { err: String(err) });
    }
  }

  log.info(`found ${discovered.length} ${storeDef.name} catalog(s) via API`);
  return discovered;
}
