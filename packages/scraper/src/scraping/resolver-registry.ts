import type { ImageExtraction } from "@bestdeal/shared";
import type { ResolveResult } from "./resolver-types.ts";

import { leafletsResolver } from "./leaflets-api-resolver.ts";
import { publitasResolver } from "./publitas-api-resolver.ts";
import { yumpuResolver } from "./yumpu-api-resolver.ts";
import { ipaperResolver } from "./ipaper-api-resolver.ts";
import { pdfResolver } from "./pdf-resolver.ts";
import { flipHtml5Resolver } from "./fliphtml5-resolver.ts";
import { flippingbookResolver } from "./flippingbook-resolver.ts";
import { digitalCatalogueResolver } from "./digital-catalogue-resolver.ts";
import { tjekResolver } from "./tjek-resolver.ts";
import { issuuResolver } from "./issuu-resolver.ts";
import { rossmannResolver } from "./rossmann-resolver.ts";
import { browserResolver } from "./resolver.ts";

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

export type ResolverName = typeof resolvers extends Record<infer K, unknown> ? K : never;

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
      url.includes("publitas.com") ||
      url.includes("cataloage.carrefour.ro") ||
      url.includes("publikace.rossmann.cz"),
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
    test: (url) => url.includes("fliphtml5.com"),
    resolverName: "fliphtml5",
  },
  {
    test: (url) => /\.pdf(\?|$)/i.test(url),
    resolverName: "pdf",
  },
  {
    test: (url) => url.includes("files.rewe.co.at"),
    resolverName: "flippingbook",
  },
  {
    test: (url) => url.includes("digital-catalogue.com"),
    resolverName: "digital-catalogue",
  },
  {
    test: (url) => url.includes("issuu.com"),
    resolverName: "issuu",
  },
  {
    test: (url) => url.includes("pro-fra-s3-magazine.rossmann.pl"),
    resolverName: "rossmann",
  },
];

// --- Explicit resolver registry ---

const resolvers: Record<string, CatalogResolver> = {
  leaflets: leafletsResolver,
  publitas: publitasResolver,
  yumpu: yumpuResolver,
  ipaper: ipaperResolver,
  pdf: pdfResolver,
  fliphtml5: flipHtml5Resolver,
  flippingbook: flippingbookResolver,
  "digital-catalogue": digitalCatalogueResolver,
  tjek: tjekResolver,
  issuu: issuuResolver,
  rossmann: rossmannResolver,
  browser: browserResolver,
};

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
  const resolver = resolvers[name];
  if (!resolver) {
    throw new Error(`No resolver registered for "${name}".`);
  }
  return resolver;
}
