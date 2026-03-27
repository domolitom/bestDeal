import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type {
  ReadonlyStorageAdapter,
  CatalogFilter,
} from "../types/storage";
import type {
  CatalogSummary,
  Catalog,
  CatalogMeta,
  CatalogPage,
} from "../types/catalog";
import type { Country } from "../types/country";
import { COUNTRY_META } from "../types/country";
import { parseCatalogId } from "../utils/config-id";

export interface R2ReadAdapterConfig {
  endpoint: string; // e.g. https://<account>.r2.cloudflarestorage.com
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string; // e.g. https://pub-xxx.r2.dev or custom domain
}

/**
 * Read-only R2 (S3-compatible) storage adapter.
 *
 * Data layout mirrors filesystem:
 *   {bucket}/
 *     {country}/{store}/
 *       {catalogId}/
 *         meta.json
 *         cover.jpg
 *         pages/
 *           page-001.jpg
 */
export class R2ReadAdapter implements ReadonlyStorageAdapter {
  protected s3: S3Client;
  protected bucket: string;
  protected publicUrl: string;

  constructor(config: R2ReadAdapterConfig) {
    this.s3 = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.bucket = config.bucket;
    // Remove trailing slash
    this.publicUrl = config.publicUrl.replace(/\/$/, "");
  }

  async listCatalogs(filter?: CatalogFilter): Promise<CatalogSummary[]> {
    try {
      const results: CatalogSummary[] = [];

      // Build prefix to narrow the listing
      let prefix = "";
      if (filter?.country) {
        prefix = `${filter.country}/`;
        if (filter?.store) {
          prefix = `${filter.country}/${filter.store}/`;
        }
      }

      // List all meta.json files under the prefix
      let continuationToken: string | undefined;
      do {
        const resp = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const obj of resp.Contents ?? []) {
          if (!obj.Key?.endsWith("/meta.json")) continue;

          try {
            const meta = await this.fetchJson<CatalogMeta>(obj.Key);
            if (filter?.status && meta.status !== filter.status) continue;

            results.push({
              id: meta.id,
              store: meta.store,
              country: meta.country,
              status: meta.status,
              dateFrom: meta.dateFrom,
              dateTo: meta.dateTo,
              catalogType: meta.catalogType,
              coverImage: meta.coverImage,
              coverThumb: meta.coverThumb,
              pageCount: meta.pageCount,
            });
          } catch {
            // Skip invalid meta.json
          }
        }

        continuationToken = resp.NextContinuationToken;
      } while (continuationToken);

      results.sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
      return results;
    } catch {
      return [];
    }
  }

  async getCatalog(id: string): Promise<Catalog | null> {
    const parsed = parseCatalogId(id);
    if (!parsed) return null;

    const metaKey = `${parsed.country}/${parsed.store}/${id}/meta.json`;

    let meta: CatalogMeta;
    try {
      meta = await this.fetchJson<CatalogMeta>(metaKey);
    } catch {
      return null;
    }

    // List page images
    const pagesPrefix = `${parsed.country}/${parsed.store}/${id}/pages/`;
    const resp = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: pagesPrefix,
      })
    );

    const pageFiles = (resp.Contents ?? [])
      .map((obj) => obj.Key!.split("/").pop()!)
      .filter((f) => /^page-\d+\.jpg$/.test(f))
      .sort();

    const pages: CatalogPage[] = pageFiles.map((f, i) => {
      const num = parseInt(f.match(/page-(\d+)/)?.[1] || String(i + 1), 10);
      return {
        number: num,
        imageUrl: this.getImageUrl(id, `pages/${f}`),
        filename: f,
      };
    });

    return { ...meta, pages };
  }

  getImageUrl(catalogId: string, filename: string): string {
    const parsed = parseCatalogId(catalogId);
    if (!parsed) return "";
    return `${this.publicUrl}/${parsed.country}/${parsed.store}/${catalogId}/${filename}`;
  }

  async listCountries(): Promise<Country[]> {
    try {
      const countries: Country[] = [];
      const countryCounts = new Map<
        string,
        { stores: Set<string>; catalogs: number }
      >();

      // List all meta.json to gather country/store info
      let continuationToken: string | undefined;
      do {
        const resp = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Delimiter: "/",
            ContinuationToken: continuationToken,
          })
        );

        // Top-level prefixes are countries
        for (const prefix of resp.CommonPrefixes ?? []) {
          const countryName = prefix.Prefix?.replace(/\/$/, "");
          if (!countryName) continue;

          if (!countryCounts.has(countryName)) {
            countryCounts.set(countryName, { stores: new Set(), catalogs: 0 });
          }
        }

        continuationToken = resp.NextContinuationToken;
      } while (continuationToken);

      // For each country, list stores and count catalogs
      for (const [countryName, counts] of countryCounts) {
        const storeResp = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: `${countryName}/`,
            Delimiter: "/",
          })
        );

        for (const prefix of storeResp.CommonPrefixes ?? []) {
          const storeName = prefix.Prefix?.replace(`${countryName}/`, "").replace(
            /\/$/,
            ""
          );
          if (!storeName) continue;
          counts.stores.add(storeName);

          // Count catalogs for this store
          const catalogResp = await this.s3.send(
            new ListObjectsV2Command({
              Bucket: this.bucket,
              Prefix: `${countryName}/${storeName}/`,
              Delimiter: "/",
            })
          );
          counts.catalogs += (catalogResp.CommonPrefixes ?? []).length;
        }

        const meta = COUNTRY_META[countryName];
        countries.push({
          code: countryName,
          name: meta?.name ?? countryName,
          flag: meta?.flag ?? "",
          storeCount: counts.stores.size,
          catalogCount: counts.catalogs,
        });
      }

      return countries;
    } catch {
      return [];
    }
  }

  async listStores(country: string): Promise<string[]> {
    try {
      const resp = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${country}/`,
          Delimiter: "/",
        })
      );

      return (resp.CommonPrefixes ?? [])
        .map((p) => p.Prefix?.replace(`${country}/`, "").replace(/\/$/, "") ?? "")
        .filter(Boolean)
        .sort();
    } catch {
      return [];
    }
  }

  protected async fetchJson<T>(key: string): Promise<T> {
    const resp = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    const body = await resp.Body!.transformToString();
    return JSON.parse(body);
  }
}
