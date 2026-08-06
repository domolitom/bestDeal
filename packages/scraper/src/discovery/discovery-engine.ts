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

interface LeafletsApiFlyer {
  offerStartDate?: string;
  offerEndDate?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
}

/** Raw JSON body returned by the Leaflets `/v4/flyer` endpoint. */
export interface LeafletsApiRawResponse {
  flyer?: LeafletsApiFlyer;
}

/**
 * PURE. Given an already-fetched Leaflets API flyer object, decide whether it
 * should be ingested and, if so, extract its dates.
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
 * Returns ISO-formatted dates or null if the flyer is missing/filtered.
 */
export function parseLeafletsApiFlyer(
  flyer: LeafletsApiFlyer | undefined | null,
  slug: string,
  allowedCategories?: string[],
  maxSpanDays?: number
): { dateFrom: string; dateTo: string } | null {
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
}

/**
 * IMPURE (network). Fetch date information for a single flyer slug from the
 * Leaflets API. Thin wrapper around `parseLeafletsApiFlyer` kept for backward
 * compatibility — callers that don't need fixture replay can use this
 * directly.
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
    const data: LeafletsApiRawResponse = await resp.json();
    return parseLeafletsApiFlyer(data.flyer, slug, allowedCategories, maxSpanDays);
  } catch (err) {
    log.warn(`Leaflets API error for slug: ${slug}`, { err: String(err) });
    return null;
  }
}

/** Raw link data collected from the browser before any date/URL parsing. */
export interface BrowserRawLink {
  href: string;
  slug: string;
  dateText: string;
  /** Overridden firstPageUrl extracted from an iframe on the linked page */
  iframeUrl?: string;
  /**
   * Raw Leaflets API response for this link's slug (dateSource: "leaflets_api"
   * only). `null` means the fetch failed or returned a non-OK status.
   * Absent when dateSource isn't "leaflets_api".
   */
  leafletsApiRaw?: LeafletsApiRawResponse | null;
}

/** Serialisable raw payload for the browser (DOM + regex) discovery path. */
export interface BrowserRawPayload {
  links: BrowserRawLink[];
}

/**
 * IMPURE (Playwright + network). Navigate the store's landing page, collect
 * candidate links, visit them when needed for text-based dates / iframe
 * extraction, and (for leaflets_api stores) fetch raw flyer JSON per slug.
 * Performs no parsing beyond what's needed to know which pages to visit next.
 */
export async function fetchRawBrowserStore(
  page: Page,
  storeDef: StoreDefinition
): Promise<BrowserRawPayload> {
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

  const rawLinks: BrowserRawLink[] = await page.evaluate(
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

  // For leaflets_api dateSource, derive the API host from the landing URL and
  // eagerly fetch raw flyer JSON per link — this is the last piece of network
  // I/O for this store; everything after fetchRawBrowserStore returns is pure.
  if (storeDef.dateSource === "leaflets_api") {
    const leafletsApiHost = deriveLeafletsApiHost(storeDef.landingUrl);
    if (leafletsApiHost) {
      for (const raw of rawLinks) {
        // Use the slug as the flyer identifier — it is extracted from the
        // link pattern (slugGroup).
        const apiUrl = `https://${leafletsApiHost}/v4/flyer?flyer_identifier=${encodeURIComponent(raw.slug)}`;
        try {
          const resp = await fetch(apiUrl);
          if (resp.ok) {
            raw.leafletsApiRaw = await resp.json();
          } else {
            log.warn(`Leaflets API ${resp.status} for slug: ${raw.slug}`);
            raw.leafletsApiRaw = null;
          }
        } catch (err) {
          log.warn(`Leaflets API error for slug: ${raw.slug}`, { err: String(err) });
          raw.leafletsApiRaw = null;
        }
      }
    }
  }

  log.info(`fetched ${rawLinks.length} raw ${storeDef.name} link(s)`);
  return { links: rawLinks };
}

/**
 * PURE. Turn a BrowserRawPayload into DiscoveredCatalog[]. No fetch, no page,
 * no I/O. `now` is accepted for signature consistency with the other parse
 * paths even though this store's date logic is relative (dateFrom/dateTo
 * pairs from the payload), not wall-clock dependent.
 */
export function parseRawBrowserStore(
  payload: BrowserRawPayload,
  storeDef: StoreDefinition,
  now: Date = new Date()
): DiscoveredCatalog[] {
  void now;

  const discovered: DiscoveredCatalog[] = [];
  for (const raw of payload.links) {
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
    if (!dates && storeDef.dateSource === "leaflets_api") {
      dates = parseLeafletsApiFlyer(
        raw.leafletsApiRaw?.flyer,
        raw.slug,
        storeDef.leafletsAllowedCategories,
        storeDef.leafletsMaxSpanDays
      );
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
 * Discover catalogs from a store's landing page using Playwright.
 * Thin composition of fetchRawBrowserStore + parseRawBrowserStore — kept for
 * callers that don't need fixture replay (this is what the pipeline uses).
 */
export async function discoverStore(
  page: Page,
  storeDef: StoreDefinition,
  now: Date = new Date()
): Promise<DiscoveredCatalog[]> {
  const payload = await fetchRawBrowserStore(page, storeDef);
  return parseRawBrowserStore(payload, storeDef, now);
}

/** Serialisable raw payload for the DOM-id + JSON-API discovery path. */
export interface ApiDiscoveryRawPayload {
  catalogIds: string[];
  /** Raw JSON response body per catalog ID; `null` = fetch failed / non-OK. */
  responses: Record<string, unknown | null>;
}

/**
 * IMPURE (Playwright + network). Extract catalog IDs from DOM data
 * attributes, then fetch each catalog's raw JSON from the API endpoint.
 */
export async function fetchRawViaApi(
  page: Page,
  storeDef: StoreDefinition
): Promise<ApiDiscoveryRawPayload> {
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
    return { catalogIds: [], responses: {} };
  }

  log.info(`found ${catalogIds.length} catalog ID(s) for ${storeDef.name}`);

  const responses: Record<string, unknown | null> = {};

  for (const id of catalogIds) {
    const apiUrl = api.apiUrl.replace("{id}", id);
    try {
      const resp = await fetch(apiUrl);
      if (!resp.ok) {
        log.info(`API ${resp.status} for ${storeDef.name} catalog ${id}`);
        responses[id] = null;
        continue;
      }
      responses[id] = await resp.json();
    } catch (err) {
      log.warn(`API error for ${storeDef.name} catalog ${id}`, { err: String(err) });
      responses[id] = null;
    }
  }

  return { catalogIds, responses };
}

/**
 * PURE. Turn an ApiDiscoveryRawPayload into DiscoveredCatalog[]. No fetch,
 * no page, no I/O.
 */
export function parseRawViaApi(
  payload: ApiDiscoveryRawPayload,
  storeDef: StoreDefinition,
  now: Date = new Date()
): DiscoveredCatalog[] {
  void now;
  const api = storeDef.apiDiscovery!;
  const discovered: DiscoveredCatalog[] = [];

  for (const id of payload.catalogIds) {
    const data = payload.responses[id] as Record<string, unknown> | null | undefined;
    if (data == null) continue;

    const firstPageUrl = data[api.fieldMap.firstPageUrl] as string | undefined;
    const rawDateFrom = data[api.fieldMap.dateFrom] as string | undefined;
    const rawDateTo = data[api.fieldMap.dateTo] as string | undefined;

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
      ? (data[api.fieldMap.coverImageUrl] as string | undefined) || firstPageUrl
      : firstPageUrl;

    const catalogType = api.fieldMap.catalogType
      ? (data[api.fieldMap.catalogType] as string | undefined)
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
  }

  log.info(`found ${discovered.length} ${storeDef.name} catalog(s) via API`);
  return discovered;
}

/**
 * Discover catalogs via API-based discovery.
 * Extracts catalog IDs from DOM data attributes, then fetches
 * catalog metadata from an API endpoint.
 * Thin composition of fetchRawViaApi + parseRawViaApi.
 */
export async function discoverStoreViaApi(
  page: Page,
  storeDef: StoreDefinition,
  now: Date = new Date()
): Promise<DiscoveredCatalog[]> {
  const payload = await fetchRawViaApi(page, storeDef);
  return parseRawViaApi(payload, storeDef, now);
}

/** Serialisable raw payload for the plain-JSON REST endpoint discovery path. */
export interface RestApiRawPayload {
  /** Raw endpoint JSON, or `null` if the fetch failed / returned non-OK. */
  endpointJson: unknown | null;
  /** Raw HTML per unique viewer URL; `null` = fetch failed / non-OK. */
  viewerPages: Record<string, string | null>;
}

/**
 * PURE. Extract the unique, non-empty viewer URLs referenced by `cfg.urlField`
 * from the endpoint JSON, in first-seen order. Shared by fetchRaw (to know
 * which pages to fetch) and parseRaw (to iterate in the same order).
 */
function extractRestApiUrls(
  endpointJson: unknown,
  cfg: NonNullable<StoreDefinition["restApiDiscovery"]>
): string[] {
  let items: unknown[];
  if (cfg.arrayField) {
    items = ((endpointJson as Record<string, unknown> | null)?.[cfg.arrayField] as unknown[]) ?? [];
  } else {
    items = Array.isArray(endpointJson) ? endpointJson : [];
  }

  const uniqueUrls = new Set<string>();
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const val = (item as Record<string, unknown>)[cfg.urlField];
    if (typeof val === "string" && val.trim()) {
      uniqueUrls.add(val.trim());
    }
  }
  return [...uniqueUrls];
}

/**
 * IMPURE (network, no Playwright required). Fetch the JSON REST endpoint,
 * then fetch each unique viewer page's raw HTML.
 *
 * This is used by Penny DE which exposes catalog viewer URLs via
 *   https://www.penny.de/.rest/market → [{flippingBookURL: "...catalogId=N"}, ...]
 */
export async function fetchRawViaRestApi(
  storeDef: StoreDefinition
): Promise<RestApiRawPayload> {
  const cfg = storeDef.restApiDiscovery!;
  log.info(`discovering ${storeDef.name} catalogs via REST API: ${cfg.endpoint}`);

  let endpointJson: unknown | null = null;
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
      return { endpointJson: null, viewerPages: {} };
    }
    endpointJson = await resp.json();
  } catch (err) {
    log.warn(`REST API fetch error for ${storeDef.name}`, { err: String(err) });
    return { endpointJson: null, viewerPages: {} };
  }

  const uniqueUrls = extractRestApiUrls(endpointJson, cfg);
  if (uniqueUrls.length === 0) {
    log.info(`no catalog URLs found for ${storeDef.name}`);
    return { endpointJson, viewerPages: {} };
  }

  log.info(`found ${uniqueUrls.length} unique catalog URL(s) for ${storeDef.name}`);

  const viewerPages: Record<string, string | null> = {};
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
        viewerPages[viewerUrl] = null;
        continue;
      }
      viewerPages[viewerUrl] = await resp.text();
    } catch (err) {
      log.warn(`failed to fetch catalog page ${viewerUrl}`, { err: String(err) });
      viewerPages[viewerUrl] = null;
    }
  }

  return { endpointJson, viewerPages };
}

/**
 * PURE. Turn a RestApiRawPayload into DiscoveredCatalog[]. No fetch, no I/O.
 *
 * Dates come from the blaetterkatalog catalog viewer page HTML:
 *   - catalogName contains "KW{n}-{yy}" which is parsed via toISODate()
 *   - The same KW value maps to the same date range, so duplicates are dropped
 */
export function parseRawViaRestApi(
  payload: RestApiRawPayload,
  storeDef: StoreDefinition,
  now: Date = new Date()
): DiscoveredCatalog[] {
  void now;
  const cfg = storeDef.restApiDiscovery!;
  const uniqueUrls = extractRestApiUrls(payload.endpointJson, cfg);

  const seenDateRanges = new Set<string>();
  const discovered: DiscoveredCatalog[] = [];

  for (const viewerUrl of uniqueUrls) {
    const html = payload.viewerPages[viewerUrl];
    if (!html) continue;

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
  }

  log.info(`found ${discovered.length} unique ${storeDef.name} catalog(s) via REST API`);
  return discovered;
}

/**
 * Discover catalogs via a plain JSON REST endpoint (no Playwright required).
 * Thin composition of fetchRawViaRestApi + parseRawViaRestApi.
 */
export async function discoverStoreViaRestApi(
  storeDef: StoreDefinition,
  now: Date = new Date()
): Promise<DiscoveredCatalog[]> {
  const payload = await fetchRawViaRestApi(storeDef);
  return parseRawViaRestApi(payload, storeDef, now);
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

/** Serialisable raw payload for the Shopfully Cloud discovery path. */
export interface ShopfullyRawPayload {
  /** Raw API response, or `null` if the fetch failed / returned non-OK. */
  response: ShopfullyFlyersResponse | null;
}

/**
 * IMPURE (network). Calls the Shopfully Cloud CloudFront-backed properties
 * endpoint:
 *   GET /v1/{language}/{propertyId}/flyers?lat={lat}&lng={lng}
 */
export async function fetchRawShopfully(
  storeDef: StoreDefinition
): Promise<ShopfullyRawPayload> {
  const cfg = storeDef.shopfullyConfig!;
  log.info(`discovering ${storeDef.name} catalogs via Shopfully Cloud...`);

  const apiBase = "https://d3k4i39zecu9l5.cloudfront.net";
  const apiKey = "eeb8526b-4f6e-48f3-8c86-d60e8c9a6d88";

  const url =
    `${apiBase}/v1/${cfg.language}/${cfg.propertyId}/flyers` +
    `?lat=${cfg.lat}&lng=${cfg.lng}`;

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
      return { response: null };
    }
    const data: ShopfullyFlyersResponse = await resp.json();
    return { response: data };
  } catch (err) {
    log.warn(`Shopfully API error for ${storeDef.name}`, { err: String(err) });
    return { response: null };
  }
}

/**
 * PURE. Turn a ShopfullyRawPayload into DiscoveredCatalog[]. No fetch, no I/O.
 *
 * Returns one DiscoveredCatalog per unique publication (deduplicated by
 * publication_url). The firstPageUrl is the PDF URL from lastPubblication.
 */
export function parseRawShopfully(
  payload: ShopfullyRawPayload,
  storeDef: StoreDefinition,
  now: Date = new Date()
): DiscoveredCatalog[] {
  void now;
  const data = payload.response;
  if (!data) {
    // Fetch failure was already logged by fetchRawShopfully.
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

/**
 * Discover catalogs via the Shopfully Cloud properties API.
 * Thin composition of fetchRawShopfully + parseRawShopfully.
 */
export async function discoverStoreViaShopfully(
  storeDef: StoreDefinition,
  now: Date = new Date()
): Promise<DiscoveredCatalog[]> {
  const payload = await fetchRawShopfully(storeDef);
  return parseRawShopfully(payload, storeDef, now);
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
/** Serialisable raw payload for the Leaflets Schwarz overview API discovery path. */
export interface LeafletsOverviewRawPayload {
  /** Raw API response, or `null` if the fetch failed / returned non-OK. */
  response: LeafletsOverviewResponse | null;
}

/**
 * IMPURE (network). Calls the Leaflets Schwarz `/v4/overview` endpoint for
 * the configured `client_locale`.
 */
export async function fetchRawLeafletsOverview(
  storeDef: StoreDefinition
): Promise<LeafletsOverviewRawPayload> {
  const cfg = storeDef.leafletsOverviewConfig!;
  log.info(`discovering ${storeDef.name} catalogs via Leaflets overview API...`);

  const apiUrl =
    `https://endpoints.leaflets.schwarz/v4/overview` +
    `?client_locale=${encodeURIComponent(cfg.clientLocale)}&region_id=0&store_id=0`;

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
      return { response: null };
    }
    const data: LeafletsOverviewResponse = await resp.json();
    return { response: data };
  } catch (err) {
    log.warn(`Leaflets overview API error for ${storeDef.name}`, { err: String(err) });
    return { response: null };
  }
}

/**
 * PURE. Turn a LeafletsOverviewRawPayload into DiscoveredCatalog[]. No fetch,
 * no I/O.
 */
export function parseRawLeafletsOverview(
  payload: LeafletsOverviewRawPayload,
  storeDef: StoreDefinition,
  now: Date = new Date()
): DiscoveredCatalog[] {
  void now;
  const cfg = storeDef.leafletsOverviewConfig!;
  const data = payload.response;

  if (!data) {
    // Fetch failure was already logged by fetchRawLeafletsOverview.
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

/**
 * Discover catalogs via the Leaflets Schwarz /v4/overview API.
 * Thin composition of fetchRawLeafletsOverview + parseRawLeafletsOverview.
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
  storeDef: StoreDefinition,
  now: Date = new Date()
): Promise<DiscoveredCatalog[]> {
  const payload = await fetchRawLeafletsOverview(storeDef);
  return parseRawLeafletsOverview(payload, storeDef, now);
}
