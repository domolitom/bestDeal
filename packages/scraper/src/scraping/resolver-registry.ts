import type { ImageExtraction } from "@bestdeal/shared";
import type { ResolveResult } from "./resolver-types.ts";

export interface ResolveInput {
  catalogId: string;
  firstPageUrl: string;
  coverImageUrl?: string;
  lastPage?: number;
  imageExtraction?: ImageExtraction;
  delayBetweenPages?: number;
}

export interface CatalogResolver {
  name: string;
  needsLastPage: boolean;
  resolve(input: ResolveInput): Promise<ResolveResult>;
}

// --- URL-based auto-detection rules ---

interface DetectionRule {
  test: (url: string) => boolean;
  resolverName: string;
}

const detectionRules: DetectionRule[] = [
  {
    test: (url) => /leaflets\.(schwarz|kaufland)/.test(url),
    resolverName: "leaflets",
  },
  {
    test: (url) =>
      url.includes("publitas.com") || url.includes("cataloage.carrefour.ro"),
    resolverName: "publitas",
  },
  {
    test: (url) => url.includes("yumpu.com"),
    resolverName: "yumpu",
  },
  {
    test: (url) =>
      url.includes("ipapercms.dk") || url.includes("ipaper.io") ||
      url.includes("/CampaignPaper/") || url.includes("/Catalog/"),
    resolverName: "ipaper",
  },
  {
    test: (url) => /\.pdf(\?|$)/i.test(url),
    resolverName: "pdf",
  },
];

// --- Registry ---

const resolvers = new Map<string, CatalogResolver>();

export function registerResolver(resolver: CatalogResolver): void {
  resolvers.set(resolver.name, resolver);
}

/**
 * Detect which resolver name matches a URL. Pure function — does not import
 * heavy resolver modules, safe to call from discoverer.
 */
export function detectResolverName(
  url: string,
  overrideName?: string
): string {
  if (overrideName) return overrideName;
  for (const rule of detectionRules) {
    if (rule.test(url)) return rule.resolverName;
  }
  return "browser";
}

/**
 * Get the resolver instance for a given URL. Checks override first,
 * then URL detection rules, then falls back to "browser".
 */
export function getResolver(
  url: string,
  overrideName?: string
): CatalogResolver {
  const name = detectResolverName(url, overrideName);
  const resolver = resolvers.get(name);
  if (!resolver) {
    throw new Error(
      `No resolver registered for "${name}". Did you import the resolver module?`
    );
  }
  return resolver;
}
