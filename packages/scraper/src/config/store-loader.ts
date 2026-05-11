import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StoreDefinition } from "@bestdeal/shared";

/**
 * Load all store definitions from stores/{country}/*.json
 */
export async function loadStoreDefinitions(
  dir = join(import.meta.dir, "../../stores")
): Promise<StoreDefinition[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const countryDirs = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

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
  const required = ["name", "landingUrl", "waitAfterLoad"] as const;
  for (const field of required) {
    if (def[field] == null) {
      throw new Error(
        `Store definition ${file} missing required field: ${field}`
      );
    }
  }

  if (def.restApiDiscovery) {
    const { endpoint, urlField } = def.restApiDiscovery;
    if (!endpoint || !urlField) {
      throw new Error(
        `Store definition ${file} has incomplete restApiDiscovery config`
      );
    }
    // restApiDiscovery stores don't need linkPatterns / dateSource / datePatterns
    return;
  }

  if (def.apiDiscovery) {
    const { selector, idAttribute, apiUrl, fieldMap } = def.apiDiscovery;
    if (!selector || !idAttribute || !apiUrl || !fieldMap) {
      throw new Error(
        `Store definition ${file} has incomplete apiDiscovery config`
      );
    }
  } else {
    if (!def.linkPatterns?.length) {
      throw new Error(
        `Store definition ${file} must have at least one linkPattern`
      );
    }
    if (!def.dateSource) {
      throw new Error(
        `Store definition ${file} missing required field: dateSource`
      );
    }
    // leaflets_api stores fetch dates from the Leaflets API — datePatterns not required
    if (def.dateSource !== "leaflets_api" && !def.datePatterns?.length) {
      throw new Error(
        `Store definition ${file} must have at least one datePattern`
      );
    }
  }
}
