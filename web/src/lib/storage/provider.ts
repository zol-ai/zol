import "server-only";

import { GoogleAuth } from "google-auth-library";

import { env } from "@/lib/env";

/**
 * Where inspection photos go.
 *
 * One provider today: a Cloud Storage bucket, written to over the JSON
 * upload API with plain fetch and a token from `google-auth-library` — the
 * same credential path `lib/db.ts` already uses for Cloud SQL, so on Cloud
 * Run it is the runtime service account and on a laptop it is
 * `gcloud auth application-default login`. No storage SDK: one upload and
 * one delete are two URLs, not a dependency.
 *
 * Unconfigured is a first-class state, not an error. `getStorageProvider()`
 * returns null when there is no bucket, the upload controls do not render,
 * and the inspection works on ratings, notes and measurements alone. Nothing
 * upstream has to know whether photos are possible.
 *
 * Objects are addressed by the URL the row stores, so the bucket has to be
 * publicly readable (or fronted by a CDN at GCS_PUBLIC_BASE_URL). Photos of
 * brake pads are not secrets; the keys carry a random segment so they cannot
 * be enumerated.
 */

export interface StoredObject {
  /** The object name inside the bucket. What `remove` takes back. */
  key: string;
  /** A URL a browser can load. */
  url: string;
}

export interface StorageProvider {
  readonly name: "gcs";
  put(object: { key: string; bytes: Uint8Array<ArrayBuffer>; contentType: string }): Promise<StoredObject>;
  remove(key: string): Promise<void>;
  /** The URL an object at `key` is served from. */
  urlFor(key: string): string;
}

class GcsProvider implements StorageProvider {
  readonly name = "gcs" as const;
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
  });

  constructor(
    private readonly bucket: string,
    private readonly publicBaseUrl: string | undefined,
  ) {}

  private async token(): Promise<string> {
    const client = await this.auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Could not obtain a Google access token for Cloud Storage.");
    return token;
  }

  urlFor(key: string): string {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    const base = this.publicBaseUrl?.replace(/\/+$/, "");
    return base ? `${base}/${encoded}` : `https://storage.googleapis.com/${this.bucket}/${encoded}`;
  }

  async put(object: { key: string; bytes: Uint8Array<ArrayBuffer>; contentType: string }): Promise<StoredObject> {
    const url =
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o` +
      `?uploadType=media&name=${encodeURIComponent(object.key)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        "Content-Type": object.contentType,
        "Content-Length": String(object.bytes.byteLength),
        // A year: the key is unique per upload, so the object never changes.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
      body: object.bytes,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Cloud Storage upload failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    return { key: object.key, url: this.urlFor(object.key) };
  }

  async remove(key: string): Promise<void> {
    const url =
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}` +
      `/o/${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(15_000),
    });

    // 404 means it is already gone, which is what the caller wanted.
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Cloud Storage delete failed (${response.status}): ${detail.slice(0, 300)}`);
    }
  }
}

let provider: StorageProvider | null | undefined;

/** The configured provider, or null when photos are not possible on this deploy. */
export function getStorageProvider(): StorageProvider | null {
  if (provider === undefined) {
    provider = env.storage.configured
      ? new GcsProvider(env.storage.bucket!, env.storage.publicBaseUrl)
      : null;
  }
  return provider;
}

export function storageConfigured(): boolean {
  return env.storage.configured;
}
