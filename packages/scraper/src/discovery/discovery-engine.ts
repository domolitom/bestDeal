import type { Page } from "playwright";
import type { StoreDefinition } from "@bestdeal/shared";
import { applyUrlTransforms, parseDates, extractCatalogType, toISODate } from "@bestdeal/shared";
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
 * If `maxSpanDays` is provided, flyers whose offer window exceeds that many
 * days are skipped (returns null). This catches seasonal/non-food catalogs
 * that share the same category string as weekly grocery flyers (e.g. in
 * Lithuania, Denmark, Serbia where the Schwarz API returns a single category
 * for all flyer types).
 *
 * Returns ISO-formatted dates or null if the call fails or flyer is filtered.
 */
export async function fetchLeafletsApiDates(
  slug: string,
  apiHost: string,
  allowedCategories?: string[],
  maxSpanDays?: number
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

    // Span guard: reject flyers whose offer window exceeds the configured limit.
    // Used for locales where the Schwarz API returns a single category for both
    // weekly grocery flyers and multi-month seasonal/non-food catalogs.
    if (maxSpanDays !== undefined) {
      const msPerDay = 86_400_000;
      const spanDays = (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / msPerDay;
      if (spanDays > maxSpanDays) {
        log.info(
          `skipping flyer "${slug}" (span ${spanDays} days exceeds max ${maxSpanDays} days)`
        );
        return null;
      }
    }

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
  const needsIpaperStaticSettings = storeDef.dateSource === "ipaper_static_settings";
  const needsPageVisit = needsTextDate || needsIpaperStaticSettings || !!storeDef.iframeExtract;
  if (needsPageVisit) {
    for (const raw of rawLinks) {
      const hasDates = raw.dateText && parseDates(raw.dateText, storeDef.datePatterns);
      // For ipaper_static_settings, always visit — card text is not authoritative for iPaper
      if (!needsIpaperStaticSettings) {
        // Skip if dates are found AND no iframe extraction needed
        if (hasDates && !storeDef.iframeExtract) continue;
        // Skip if dates are found AND iframe already extracted
        if (hasDates && raw.iframeUrl) continue;
      }
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

        // For iPaper-based catalogs, read window.staticSettings.name directly
        if (needsIpaperStaticSettings) {
          const staticName = await page.evaluate(
            () =>
              (window as unknown as { staticSettings?: { name?: string } }).staticSettings?.name ??
              ""
          );
          raw.dateText = staticName;
        } else if (!hasDates && needsTextDate) {
          // Extract dates if still needed via meta or html fallback
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
        storeDef.dateSource === "slug_then_text" ||
        storeDef.dateSource === "ipaper_static_settings")
    ) {
      dates = parseDates(raw.dateText, storeDef.datePatterns);
    }
    if (!dates && storeDef.dateSource === "leaflets_api" && leafletsApiHost) {
      // Use the slug as the flyer identifier to fetch dates from the Leaflets API.
      // The slug is extracted from the link pattern (slugGroup) — it is the flyer identifier.
      dates = await fetchLeafletsApiDates(raw.slug, leafletsApiHost, storeDef.leafletsAllowedCategories, storeDef.leafletsMaxSpanDays);
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

/**
 * Discover catalogs via a plain JSON REST endpoint (no Playwright required).
 *
 * The endpoint must return a JSON array (or an object with an `arrayField`).
 * Each element is scanned for `urlField`.  Duplicate URLs are removed.
 *
 * Dates are fetched from the blaetterkatalog catalog viewer page:
 *   - catalogName contains "KW{n}-{yy}" which is parsed via toISODate()
 *   - The same KW value maps to the same date range, so duplicates are dropped
 *
 * This is used by Penny DE which exposes catalog viewer URLs via
 *   https://www.penny.de/.rest/market → [{flippingBookURL: "...catalogId=N"}, ...]
 */
export async function discoverStoreViaRestApi(
  storeDef: StoreDefinition
): Promise<DiscoveredCatalog[]> {
  const cfg = storeDef.restApiDiscovery!;
  log.info(`discovering ${storeDef.name} catalogs via REST API: ${cfg.endpoint}`);

  // 1. Fetch the JSON endpoint
  let items: unknown[];
  try {
    const resp = await fetch(cfg.endpoint, {
      signal: AbortSignal.timeout(30000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      log.warn(`REST API ${resp.status} for ${storeDef.name}`);
      return [];
    }
    const json = await resp.json();
    if (cfg.arrayField) {
      items = (json as Record<string, unknown>)[cfg.arrayField] as unknown[] ?? [];
    } else {
      items = Array.isArray(json) ? json : [];
    }
  } catch (err) {
    log.warn(`REST API fetch error for ${storeDef.name}`, { err: String(err) });
    return [];
  }

  // 2. Extract unique non-null viewer URLs
  const uniqueUrls = new Set<string>();
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const val = (item as Record<string, unknown>)[cfg.urlField];
    if (typeof val === "string" && val.trim()) {
      uniqueUrls.add(val.trim());
    }
  }

  if (uniqueUrls.size === 0) {
    log.info(`no catalog URLs found for ${storeDef.name}`);
    return [];
  }

  log.info(`found ${uniqueUrls.size} unique catalog URL(s) for ${storeDef.name}`);

  // 3. For each unique URL, fetch the viewer page to get catalog dates
  //    Deduplicate by date range (same KW week → same date range).
  const seenDateRanges = new Set<string>();
  const discovered: DiscoveredCatalog[] = [];

  for (const viewerUrl of uniqueUrls) {
    try {
      const resp = await fetch(viewerUrl, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });
      if (!resp.ok) {
        log.info(`catalog page ${resp.status}: ${viewerUrl}`);
        continue;
      }

      const html = await resp.text();

      // Extract catalogName from: var catalogName = 'PENNY-HZ-KW20-15A-08-26';
      const nameMatch = html.match(/var\s+catalogName\s*=\s*['"]([^'"]+)['"]/);
      if (!nameMatch) {
        log.info(`no catalogName found in: ${viewerUrl}`);
        continue;
      }
      const catalogName = nameMatch[1]!;

      // Extract KW from catalog name, e.g. "PENNY-HZ-KW20-15A-08-26" → "KW20-26"
      const kwMatch = catalogName.match(/KW(\d+)-(?:[\w]+-)*(\d{2})(?:$|-)/);
      if (!kwMatch) {
        log.info(`no KW date found in catalogName "${catalogName}": ${viewerUrl}`);
        continue;
      }

      const kwCode = `KW${kwMatch[1]}-${kwMatch[2]}`;
      const dateFrom = toISODate(kwCode);
      const dateTo = toISODate(kwCode, undefined, true);
      const dateKey = `${dateFrom}|${dateTo}`;

      if (seenDateRanges.has(dateKey)) {
        // Same week, different regional edition — skip duplicate
        continue;
      }
      seenDateRanges.add(dateKey);

      discovered.push({
        store: storeDef.name,
        country: storeDef.country,
        slug: catalogName,
        dateFrom,
        dateTo,
        firstPageUrl: viewerUrl,
        coverImageUrl: viewerUrl,
      });
    } catch (err) {
      log.warn(`failed to fetch catalog page ${viewerUrl}`, { err: String(err) });
    }
  }

  log.info(`found ${discovered.length} unique ${storeDef.name} catalog(s) via REST API`);
  return discovered;
}

// --- Shopfully Cloud types ---

interface ShopfullyFlyer {
  id: string;
  start_date: string;
  end_date: string;
  publication_url: string;
  lastPubblication?: {
    pdf_url?: string;
    settings?: {
      number_of_pages?: number;
    };
  };
}

interface ShopfullyFlyersResponse {
  status: string;
  data?: {
    list?: Record<string, ShopfullyFlyer>;
  };
}

/**
 * Discover catalogs via the Shopfully Cloud properties API.
 *
 * Calls the CloudFront-backed properties endpoint:
 *   GET /v1/{language}/{propertyId}/flyers?lat={lat}&lng={lng}
 *
 * Returns one DiscoveredCatalog per unique publication (deduplicated by
 * publication_url). The firstPageUrl is the PDF URL from lastPubblication.
 */
export async function discoverStoreViaShopfully(
  storeDef: StoreDefinition
): Promise<DiscoveredCatalog[]> {
  const cfg = storeDef.shopfullyConfig!;
  log.info(`discovering ${storeDef.name} catalogs via Shopfully Cloud...`);

  const apiBase = "https://d3k4i39zecu9l5.cloudfront.net";
  const apiKey = "eeb8526b-4f6e-48f3-8c86-d60e8c9a6d88";

  const url =
    `${apiBase}/v1/${cfg.language}/${cfg.propertyId}/flyers` +
    `?lat=${cfg.lat}&lng=${cfg.lng}`;

  let data: ShopfullyFlyersResponse;
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "x-api-key": apiKey,
        "Origin": "https://viewer-whitelabel.shopfully.cloud",
        "Referer": "https://viewer-whitelabel.shopfully.cloud/",
      },
    });
    if (!resp.ok) {
      log.warn(`Shopfully API ${resp.status} for ${storeDef.name}`);
      return [];
    }
    data = await resp.json();
  } catch (err) {
    log.warn(`Shopfully API error for ${storeDef.name}`, { err: String(err) });
    return [];
  }

  if (data.status !== "SUCCESS" || !data.data?.list) {
    log.warn(`Shopfully API bad response for ${storeDef.name}: ${data.status}`);
    return [];
  }

  const flyerList = data.data.list;
  const discovered: DiscoveredCatalog[] = [];
  // Deduplicate by publication_url so the same catalog across multiple stores appears once
  const seenPublicationUrls = new Set<string>();

  for (const flyer of Object.values(flyerList)) {
    const pdfUrl = flyer.lastPubblication?.pdf_url;
    if (!pdfUrl) {
      log.info(`skipping Shopfully flyer ${flyer.id} (no pdf_url)`);
      continue;
    }

    // Deduplicate by publication_url
    if (seenPublicationUrls.has(flyer.publication_url)) {
      continue;
    }
    seenPublicationUrls.add(flyer.publication_url);

    const dateFrom = flyer.start_date;
    const dateTo = flyer.end_date;

    if (!dateFrom || !dateTo) {
      log.info(`skipping Shopfully flyer ${flyer.id} (missing dates)`);
      continue;
    }

    discovered.push({
      store: storeDef.name,
      country: storeDef.country,
      slug: flyer.id,
      dateFrom,
      dateTo,
      firstPageUrl: pdfUrl,
      coverImageUrl: pdfUrl,
    });
  }

  log.info(`found ${discovered.length} ${storeDef.name} catalog(s) via Shopfully`);
  return discovered;
}

// --- Leaflets Overview API types ---

interface LeafletsOverviewFlyer {
  id: string;
  offerStartDate?: string;
  offerEndDate?: string;
  startDate?: string;
  endDate?: string;
  flyerUrlAbsolute?: string;
  thumbnailUrl?: string;
}

interface LeafletsOverviewSubcategory {
  name: string;
  flyers: LeafletsOverviewFlyer[];
}

interface LeafletsOverviewCategory {
  subcategories: LeafletsOverviewSubcategory[];
}

interface LeafletsOverviewResponse {
  success?: boolean;
  categories?: LeafletsOverviewCategory[];
}

/**
 * Discover catalogs via the Leaflets Schwarz /v4/overview API.
 *
 * This is used for Lidl country pages where weekly flyers are rendered as
 * regionalized <button> elements (not <a> links), which prevents standard
 * DOM-based link discovery.  The overview API returns all flyers for a given
 * locale directly, without needing a browser.
 *
 * The `leafletsOverviewConfig.subcategoryFilter` restricts results to a single
 * subcategory (e.g. "Volantini settimanali" for Lidl IT).
 *
 * The `flyerUrlAbsolute` from the API is used as firstPageUrl after applying
 * the store's `linkPatterns` normalizeUrl transforms.
 */
export async function discoverStoreViaLeafletsOverview(
  storeDef: StoreDefinition
): Promise<DiscoveredCatalog[]> {
  const cfg = storeDef.leafletsOverviewConfig!;
  log.info(`discovering ${storeDef.name} catalogs via Leaflets overview API...`);

  const apiUrl =
    `https://endpoints.leaflets.schwarz/v4/overview` +
    `?client_locale=${encodeURIComponent(cfg.clientLocale)}&region_id=0&store_id=0`;

  let data: LeafletsOverviewResponse;
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      log.warn(`Leaflets overview API ${resp.status} for ${storeDef.name}`);
      return [];
    }
    data = await resp.json();
  } catch (err) {
    log.warn(`Leaflets overview API error for ${storeDef.name}`, { err: String(err) });
    return [];
  }

  if (!data.success || !data.categories) {
    log.warn(`Leaflets overview API bad response for ${storeDef.name}`);
    return [];
  }

  const discovered: DiscoveredCatalog[] = [];
  const seenIds = new Set<string>();

  for (const category of data.categories) {
    for (const subcategory of category.subcategories) {
      // Apply subcategory filter if configured
      if (cfg.subcategoryFilter && subcategory.name !== cfg.subcategoryFilter) {
        log.info(`skipping subcategory "${subcategory.name}" (filter: "${cfg.subcategoryFilter}")`);
        continue;
      }

      for (const flyer of subcategory.flyers) {
        if (!flyer.flyerUrlAbsolute) {
          log.info(`skipping flyer ${flyer.id} (no flyerUrlAbsolute)`);
          continue;
        }

        // Deduplicate by flyer ID
        if (seenIds.has(flyer.id)) continue;
        seenIds.add(flyer.id);

        const dateFrom = flyer.offerStartDate || flyer.startDate;
        const dateTo = flyer.offerEndDate || flyer.endDate;

        if (!dateFrom || !dateTo) {
          log.info(`skipping flyer ${flyer.id} (missing dates)`);
          continue;
        }

        // Normalize the flyerUrlAbsolute using the store's linkPatterns normalizeUrl
        let firstPageUrl = flyer.flyerUrlAbsolute;
        for (const lp of storeDef.linkPatterns) {
          if (new RegExp(lp.match).test(flyer.flyerUrlAbsolute)) {
            firstPageUrl = applyUrlTransforms(flyer.flyerUrlAbsolute, lp.normalizeUrl);
            break;
          }
        }

        // Extract slug from the flyerUrlAbsolute for use as catalog ID component
        let slug = flyer.id;
        for (const lp of storeDef.linkPatterns) {
          const m = flyer.flyerUrlAbsolute.match(new RegExp(lp.match));
          if (m && lp.slugGroup > 0) {
            slug = m[lp.slugGroup] || flyer.id;
            break;
          }
        }

        discovered.push({
          store: storeDef.name,
          country: storeDef.country,
          slug,
          dateFrom,
          dateTo,
          firstPageUrl,
          coverImageUrl: flyer.thumbnailUrl || firstPageUrl,
        });
      }
    }
  }

  log.info(`found ${discovered.length} ${storeDef.name} catalog(s) via Leaflets overview`);
  return discovered;
}
