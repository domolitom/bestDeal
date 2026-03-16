import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import type { StorageAdapter, CatalogMeta } from "@bestdeal/shared";
import { R2ReadAdapter } from "@bestdeal/shared/storage/r2";
import type { R2ReadAdapterConfig } from "@bestdeal/shared/storage/r2";
import { parseCatalogId } from "@bestdeal/shared";

/**
 * Read-write R2 storage adapter for the scraper.
 * Inherits all read operations from R2ReadAdapter and adds write methods.
 */
export class R2StorageAdapter extends R2ReadAdapter implements StorageAdapter {
  constructor(config: R2ReadAdapterConfig) {
    super(config);
  }

  async writeCatalogMeta(meta: CatalogMeta): Promise<void> {
    const parsed = parseCatalogId(meta.id);
    if (!parsed) throw new Error(`Invalid catalog ID: ${meta.id}`);

    const key = `${parsed.country}/${parsed.store}/${meta.id}/meta.json`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(meta, null, 2),
        ContentType: "application/json",
      })
    );
  }

  async writeImage(
    catalogId: string,
    filename: string,
    data: Buffer
  ): Promise<void> {
    const parsed = parseCatalogId(catalogId);
    if (!parsed) throw new Error(`Invalid catalog ID: ${catalogId}`);

    let key: string;
    if (filename.startsWith("page-")) {
      key = `${parsed.country}/${parsed.store}/${catalogId}/pages/${filename}`;
    } else {
      key = `${parsed.country}/${parsed.store}/${catalogId}/${filename}`;
    }

    const ext = filename.split(".").pop()?.toLowerCase();
    const contentType =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : "application/octet-stream";

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: "public, max-age=604800, immutable",
      })
    );
  }

  /** Delete all objects for a catalog from R2. */
  async deleteCatalog(catalogId: string): Promise<void> {
    const parsed = parseCatalogId(catalogId);
    if (!parsed) throw new Error(`Invalid catalog ID: ${catalogId}`);

    const prefix = `${parsed.country}/${parsed.store}/${catalogId}/`;
    let continuationToken: string | undefined;

    do {
      const resp = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      const keys = (resp.Contents ?? [])
        .map((obj) => obj.Key!)
        .filter(Boolean);

      if (keys.length > 0) {
        await this.s3.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          })
        );
      }

      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);
  }

  /** Write a per-country manifest.json (e.g. romania/manifest.json). */
  async writeManifest(json: string, country?: string): Promise<void> {
    const key = country ? `${country}/manifest.json` : "manifest.json";
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: json,
        ContentType: "application/json",
        CacheControl: "public, max-age=60",
      })
    );
  }
}
