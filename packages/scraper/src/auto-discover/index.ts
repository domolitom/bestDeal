import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StoreDefinition } from "@bestdeal/shared";
import { discoverLinks } from "./link-discovery-service.ts";
import { generateStoreConfig } from "./config-generator.ts";
import { createLogger } from "../logger.ts";

const log = createLogger({ module: "auto-discover" });

// --- Validation ---

function validateConfig(config: StoreDefinition): void {
  const required: (keyof StoreDefinition)[] = [
    "name",
    "landingUrl",
    "waitAfterLoad",
    "linkPatterns",
    "dateSource",
    "datePatterns",
  ];
  for (const field of required) {
    if (config[field] == null) {
      throw new Error(`Generated config missing required field: ${field}`);
    }
  }

  if (!Array.isArray(config.linkPatterns) || config.linkPatterns.length === 0) {
    throw new Error("Generated config must have at least one linkPattern");
  }
  if (!Array.isArray(config.datePatterns) || config.datePatterns.length === 0) {
    throw new Error("Generated config must have at least one datePattern");
  }

  const validDateSources = ["slug", "text", "slug_then_text"];
  if (!validDateSources.includes(config.dateSource)) {
    throw new Error(
      `Invalid dateSource "${config.dateSource}" — must be one of: ${validDateSources.join(", ")}`
    );
  }

  // Validate regex compilation
  for (const lp of config.linkPatterns) {
    try {
      new RegExp(lp.match);
    } catch (err) {
      throw new Error(
        `linkPattern regex failed to compile: "${lp.match}" — ${err}`
      );
    }
    if (!Array.isArray(lp.normalizeUrl)) {
      throw new Error(
        `linkPattern "${lp.match}" must have a normalizeUrl array`
      );
    }
  }

  for (const dp of config.datePatterns) {
    try {
      new RegExp(dp.match);
    } catch (err) {
      throw new Error(
        `datePattern regex failed to compile: "${dp.match}" — ${err}`
      );
    }
  }
}

// --- Verification (best-effort) ---

async function verifyConfig(config: StoreDefinition): Promise<void> {
  try {
    const { discoverStore } = await import(
      "../discovery/discovery-engine.ts"
    );
    const { chromium } = await import("playwright");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 800, height: 1200 },
    });
    const page = await context.newPage();

    try {
      const catalogs = await discoverStore(page, config);
      if (catalogs.length === 0) {
        log.warn("verification found 0 catalogs — config may need manual tuning");
      } else {
        for (const c of catalogs) {
          log.info(`  - ${c.store} ${c.dateFrom} to ${c.dateTo}`);
        }
      }
    } finally {
      await browser.close();
    }
  } catch (err) {
    log.warn(`verification failed`, { err: String(err) });
  }
}

// --- Orchestrator ---

export async function runAutoDiscover(options: {
  url: string;
  store: string;
  country: string;
}): Promise<string> {
  const { url, store, country } = options;

  // Step 1: Extract links
  log.info("=== Step 1: Extracting links ===");
  const linkResult = await discoverLinks(url);
  if (linkResult.links.length === 0) {
    throw new Error(`No links found on ${url}`);
  }

  // Step 2: Generate config via LLM
  log.info("=== Step 2: Generating config via LLM ===");
  const config = await generateStoreConfig({
    storeName: store,
    landingUrl: url,
    links: linkResult.links,
  });

  // Inject country for verification (not written to file)
  config.country = country;

  // Step 3: Validate
  log.info("=== Step 3: Validating config ===");
  validateConfig(config);
  log.info("validation passed");

  // Step 4: Write config file (strip country field — injected at load time)
  log.info("=== Step 4: Writing config ===");
  const storesDir = join(import.meta.dir, "../../stores", country);
  await mkdir(storesDir, { recursive: true });
  const configPath = join(storesDir, `${store}.json`);

  const { country: _country, ...configWithoutCountry } = config;
  await writeFile(
    configPath,
    JSON.stringify(configWithoutCountry, null, 4) + "\n"
  );
  log.info(`wrote ${configPath}`);

  // Step 5: Verify (best-effort)
  log.info("=== Step 5: Verification ===");
  await verifyConfig(config);

  return configPath;
}
