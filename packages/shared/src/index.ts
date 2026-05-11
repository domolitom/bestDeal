// Types
export type {
  CatalogStatus,
  CatalogPage,
  CatalogMeta,
  Catalog,
  CatalogSummary,
  ScrapingInfo,
} from "./types/catalog";

export type {
  UrlReplace,
  UrlAppend,
  UrlElse,
  UrlTransform,
  LinkPattern,
  DatePattern,
  CatalogTypePattern,
  ImageExtraction,
  ApiDiscoveryFieldMap,
  ApiDiscoveryConfig,
  RestApiDiscoveryConfig,
  StoreDefinition,
} from "./types/store";

export type {
  CatalogFilter,
  ReadonlyStorageAdapter,
  StorageAdapter,
} from "./types/storage";

// Storage adapters are NOT re-exported here to keep this barrel client-safe
// (they use node:fs / @aws-sdk which can't be bundled by webpack for the browser).
// Import them directly:
//   import { FsReadAdapter } from "@bestdeal/shared/storage/fs";
//   import { R2ReadAdapter } from "@bestdeal/shared/storage/r2";

export type { Country } from "./types/country";
export { COUNTRY_META, COUNTRY_CODE_ALIASES } from "./types/country";

// Utilities
export {
  parseDates,
  toISODate,
  formatDate,
  isCatalogActive,
  getFreshnessLabel,
} from "./utils/dates";

export { buildCatalogId, parseCatalogId } from "./utils/config-id";
export type { ConfigIdInput } from "./utils/config-id";

export {
  applyUrlTransforms,
  extractCatalogType,
  extractPageNumber,
  buildPageURL,
} from "./utils/url-transforms";
