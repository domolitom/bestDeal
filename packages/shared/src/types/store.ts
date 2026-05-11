// --- URL Transform types ---

export interface UrlReplace {
  type: "replace";
  match: string;
  replacement: string;
}

export interface UrlAppend {
  type: "append";
  suffix: string;
}

export interface UrlElse {
  type: "else";
  condition: string;
  ifTrue: UrlReplace;
  ifFalse: UrlReplace;
}

export type UrlTransform = UrlReplace | UrlAppend | UrlElse;

// --- Link pattern ---

export interface LinkPattern {
  match: string;
  slugGroup: number;
  normalizeUrl: UrlTransform[];
}

// --- Date pattern ---

export interface DatePattern {
  match: string;
  dateFrom: string;
  dateTo: string;
}

// --- Catalog type pattern ---

export interface CatalogTypePattern {
  match: string;
  caseInsensitive?: boolean;
  transform?: "lowercase" | "uppercase";
}

// --- Image extraction config ---

export interface ImageExtraction {
  /** CSS selector to find the main page image */
  selector?: string;
  /** Minimum width in px to consider an image valid */
  minWidth?: number;
  /** Minimum height in px to consider an image valid */
  minHeight?: number;
  /** CSS selectors to exclude (e.g. nav, sidebar) */
  excludeSelectors?: string[];
}

// --- API-based discovery config ---

export interface ApiDiscoveryFieldMap {
  firstPageUrl: string;
  dateFrom: string;
  dateTo: string;
  coverImageUrl?: string;
  catalogType?: string;
}

export interface ApiDiscoveryConfig {
  /** CSS selector for catalog elements on the landing page */
  selector: string;
  /** Data attribute containing the catalog identifier (e.g. "data-catalog") */
  idAttribute: string;
  /** API URL template. Use `{id}` as placeholder for the catalog ID */
  apiUrl: string;
  /** Mappings from API response fields to catalog fields */
  fieldMap: ApiDiscoveryFieldMap;
}

// --- REST API discovery config (no DOM / no Playwright needed) ---

/**
 * Configures discovery via a plain JSON REST endpoint.
 *
 * The endpoint must return a JSON array (or an object wrapping an array under
 * `arrayField`). Each element is scanned for `urlField`.  Duplicate URLs are
 * removed.  Dates are extracted from the catalog viewer page itself (via the
 * `blaetterkatalog` resolver) rather than from the REST response.
 *
 * Example (Penny DE):
 *   endpoint: "https://www.penny.de/.rest/market"
 *   urlField:  "flippingBookURL"
 */
export interface RestApiDiscoveryConfig {
  /** URL of the JSON REST endpoint */
  endpoint: string;
  /**
   * Key in each array element that contains the catalog viewer URL.
   * Null/empty values are skipped automatically.
   */
  urlField: string;
  /**
   * Optional: if the JSON root is an object, name of the key whose value is
   * the array to iterate.  Omit when the root is already an array.
   */
  arrayField?: string;
}

// --- Store definition ---

export interface StoreDefinition {
  name: string;
  country: string; // injected from folder name at load time
  displayName?: string;
  logoPath?: string;
  landingUrl: string;
  waitAfterLoad: number;
  delayBetweenPages?: number;
  linkDomain?: string;
  /** CSS selector for elements containing catalog URLs (default: a[href], iframe[src]) */
  linkSelector?: string;
  /** DOM attribute to read the URL from (default: href/src depending on element) */
  linkAttribute?: string;
  linkPatterns: LinkPattern[];
  dateSource: "slug" | "text" | "slug_then_text" | "leaflets_api";
  datePatterns: DatePattern[];
  /**
   * When dateSource is "leaflets_api", only accept flyers whose `category`
   * field is in this list. Omit to accept all categories.
   */
  leafletsAllowedCategories?: string[];
  catalogTypePattern?: CatalogTypePattern;
  imageExtraction?: ImageExtraction;
  resolver?: string; // override auto-detection ("leaflets" | "browser" | etc.)
  /** When visiting linked pages, extract an iframe URL matching this pattern to use as firstPageUrl */
  iframeExtract?: string;
  apiDiscovery?: ApiDiscoveryConfig;
  /** Discovery via a plain JSON REST endpoint (no Playwright required) */
  restApiDiscovery?: RestApiDiscoveryConfig;
}
