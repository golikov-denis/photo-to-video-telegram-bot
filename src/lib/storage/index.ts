import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, put } from "@vercel/blob";
import type { ImageMetadata } from "../images";
import type { AppConfig, StoredAsset } from "../domain/types";

export interface SourceStorage {
  putSource(
    taskId: string,
    bytes: Buffer,
    image: ImageMetadata,
  ): Promise<StoredAsset>;
  deleteSource(asset: StoredAsset): Promise<void>;
}

export class BlobSourceStorage implements SourceStorage {
  constructor(private readonly token: string) {}

  async putSource(
    taskId: string,
    bytes: Buffer,
    image: ImageMetadata,
  ): Promise<StoredAsset> {
    const pathname = `sources/${taskId}.${image.extension}`;
    const blob = await put(pathname, bytes, {
      access: "public",
      contentType: image.contentType,
      addRandomSuffix: false,
      token: this.token,
    });
    return { url: blob.url, pathname: blob.pathname };
  }

  async deleteSource(asset: StoredAsset): Promise<void> {
    await del(asset.url, { token: this.token });
  }
}

export class LocalSourceStorage implements SourceStorage {
  private readonly root = path.join(process.cwd(), ".data");

  async putSource(
    taskId: string,
    bytes: Buffer,
    image: ImageMetadata,
  ): Promise<StoredAsset> {
    const pathname = `sources/${taskId}.${image.extension}`;
    const destination = path.join(this.root, pathname);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
    return { url: `https://local.invalid/${pathname}`, pathname };
  }

  async deleteSource(asset: StoredAsset): Promise<void> {
    const destination = path.resolve(this.root, asset.pathname);
    const root = path.resolve(this.root);
    if (!destination.startsWith(`${root}${path.sep}`)) return;
    await unlink(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export function createSourceStorage(config: AppConfig): SourceStorage {
  if (config.blobToken) return new BlobSourceStorage(config.blobToken);
  if (config.useMockRunway) return new LocalSourceStorage();
  throw new Error("BLOB_READ_WRITE_TOKEN is required when MOCK mode is off.");
}
