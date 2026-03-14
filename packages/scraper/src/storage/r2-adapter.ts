import {
  S3Client,
  PutObjectCommand,
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
}
