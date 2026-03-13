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

  // For links with no dateText, try fetching the linked page's meta description
  const needsTextDate =
    storeDef.dateSource === "text" || storeDef.dateSource === "slug_then_text";
  if (needsTextDate) {
    for (const raw of rawLinks) {
      // Skip if we already have dates from surrounding text
      if (raw.dateText && parseDates(raw.dateText, storeDef.datePatterns)) continue;
      try {
        await page.goto(raw.href, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(5000);
        // Try meta description first; if no dates there, fall back to raw HTML
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
      } catch (err) {
        console.warn(`[discovery] failed to visit ${raw.href}: ${err}`);
      }
    }
    // Navigate back so the page state is clean
    await page.goto(storeDef.landingUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(storeDef.waitAfterLoad);
  }

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
  console.log(`[discovery] discovering ${storeDef.name} catalogs via API...`);

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
    console.log(`[discovery] no catalog IDs found for ${storeDef.name}`);
    return [];
  }

  console.log(
    `[discovery] found ${catalogIds.length} catalog ID(s) for ${storeDef.name}`
  );

  const discovered: DiscoveredCatalog[] = [];

  for (const id of catalogIds) {
    const apiUrl = api.apiUrl.replace("{id}", id);
    try {
      const resp = await fetch(apiUrl);
      if (!resp.ok) {
        console.log(
          `[discovery] API ${resp.status} for ${storeDef.name} catalog ${id}`
        );
        continue;
      }

      const data = await resp.json();

      const firstPageUrl = data[api.fieldMap.firstPageUrl];
      const rawDateFrom = data[api.fieldMap.dateFrom];
      const rawDateTo = data[api.fieldMap.dateTo];

      if (!firstPageUrl || !rawDateFrom || !rawDateTo) {
        console.log(
          `[discovery] skipping ${storeDef.name} catalog ${id} (missing fields)`
        );
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
      console.log(
        `[discovery] API error for ${storeDef.name} catalog ${id}: ${err}`
      );
    }
  }

  console.log(
    `[discovery] found ${discovered.length} ${storeDef.name} catalog(s) via API`
  );
  return discovered;
}
