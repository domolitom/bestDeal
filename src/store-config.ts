import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// --- Types ---

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

export interface LinkPattern {
  match: string;
  slugGroup: number;
  normalizeUrl: UrlTransform[];
}

export interface DatePattern {
  match: string;
  dateFrom: string;
  dateTo: string;
}

export interface CatalogTypePattern {
  match: string;
  caseInsensitive?: boolean;
  transform?: "lowercase" | "uppercase";
}

export interface StoreDefinition {
  name: string;
  country: string;
  landingUrl: string;
  waitAfterLoad: number;
  linkDomain?: string;
  linkPatterns: LinkPattern[];
  dateSource: "slug" | "text" | "slug_then_text";
  datePatterns: DatePattern[];
  catalogTypePattern?: CatalogTypePattern;
}

// --- Loader ---

export async function loadStoreDefinitions(
  dir = "stores"
): Promise<StoreDefinition[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const countryDirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const definitions: StoreDefinition[] = [];

  for (const countryDir of countryDirs) {
    const country = countryDir.name;
    const countryPath = join(dir, country);
    const files = await readdir(countryPath);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

    for (const file of jsonFiles) {
      const raw = await readFile(join(countryPath, file), "utf-8");
      const def: StoreDefinition = JSON.parse(raw);
      def.country = country;
      validateStoreDefinition(def, `${country}/${file}`);
      definitions.push(def);
    }
  }

  return definitions;
}

function validateStoreDefinition(def: StoreDefinition, file: string): void {
  const required = ["name", "landingUrl", "waitAfterLoad", "linkPatterns", "dateSource", "datePatterns"] as const;
  for (const field of required) {
    if (def[field] == null) {
      throw new Error(`Store definition ${file} missing required field: ${field}`);
    }
  }
  if (def.linkPatterns.length === 0) {
    throw new Error(`Store definition ${file} must have at least one linkPattern`);
  }
  if (def.datePatterns.length === 0) {
    throw new Error(`Store definition ${file} must have at least one datePattern`);
  }
}
