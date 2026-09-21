import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env";

// E-03/E-06 — the object store boundary.
//
// One tiny interface, two implementations:
//
//   r2ObjectStore()      S3-compatible requests signed with aws4fetch
//                        (MIT, zero deps) against Cloudflare R2.
//   disabledObjectStore() the fail-loud placeholder used everywhere
//                        the four R2_* variables are not all set.
//
// Callers that can run in a test or a store-less environment take an
// `ObjectStore` parameter and default to getObjectStore() — see
// lib/jobs/audit-checkpoint-job.ts and lib/jobs/activity-export-job.ts.
//
// Credentials come from lib/env.ts and are never logged. Error messages
// carry the key and the HTTP status only: an R2 failure is diagnosable
// from the object key, and a crash report must never leak the signing
// key.

export interface ObjectStore {
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Returns null when the object does not exist (HTTP 404). */
  getObject(key: string): Promise<Uint8Array | null>;
  /** PR1-C11 — every key under the prefix, for backup retention. */
  listObjects(prefix: string): Promise<string[]>;
  /** PR1-C11 — deletes one key; a missing key is not an error. */
  deleteObject(key: string): Promise<void>;
}

// Thrown by disabledObjectStore().putObject(). Distinct type so a
// caller could branch on "not configured" vs "R2 said no" — the
// checkpoint job surfaces it as a hard failure, not a silent skip.
export class ObjectStoreDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStoreDisabledError";
  }
}

const R2_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

export function isObjectStoreEnabled(): boolean {
  return R2_VARS.every((name) => {
    const value = env[name];
    return typeof value === "string" && value.length > 0;
  });
}

// Keys are built from ids and dates (no spaces, no unicode), but encode
// each segment anyway so a future caller's key can never break the URL
// or collide with the bucket prefix.
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function r2ObjectStore(): ObjectStore {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new ObjectStoreDisabledError(
      "r2ObjectStore(): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET must all be set",
    );
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const urlFor = (key: string) => `${endpoint}/${bucket}/${encodeKey(key)}`;

  return {
    async putObject(key, bytes, contentType) {
      const response = await client.fetch(urlFor(key), {
        method: "PUT",
        // A fresh Uint8Array over the same bytes: `bytes` may be a
        // Buffer (ArrayBufferLike backing), which the DOM BodyInit
        // types do not accept; `.buffer` on a Uint8Array<ArrayBuffer>
        // is a plain ArrayBuffer and always type-checks.
        body: new Uint8Array(bytes).buffer,
        headers: { "Content-Type": contentType },
      });
      if (!response.ok) {
        throw new Error(
          `R2 putObject failed (HTTP ${response.status}) for object "${key}"`,
        );
      }
    },

    async getObject(key) {
      const response = await client.fetch(urlFor(key), { method: "GET" });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(
          `R2 getObject failed (HTTP ${response.status}) for object "${key}"`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    async listObjects(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const params = new URLSearchParams({ "list-type": "2", prefix });
        if (token) params.set("continuation-token", token);
        const response = await client.fetch(
          `${endpoint}/${bucket}?${params.toString()}`,
          { method: "GET" },
        );
        if (!response.ok) {
          throw new Error(
            `R2 listObjects failed (HTTP ${response.status}) for prefix "${prefix}"`,
          );
        }
        const xml = await response.text();
        for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
          keys.push(decodeXmlEntities(match[1]!));
        }
        const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(
          xml,
        );
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? next?.[1]
          : undefined;
      } while (token);
      return keys;
    },

    async deleteObject(key) {
      const response = await client.fetch(urlFor(key), { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new Error(
          `R2 deleteObject failed (HTTP ${response.status}) for object "${key}"`,
        );
      }
    },
  };
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function disabledObjectStore(): ObjectStore {
  return {
    async putObject(key) {
      throw new ObjectStoreDisabledError(
        `Object store is disabled — R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET must all be set before object "${key}" can be stored.`,
      );
    },
    async getObject() {
      return null;
    },
    async listObjects() {
      return [];
    },
    async deleteObject(key) {
      throw new ObjectStoreDisabledError(
        `Object store is disabled — cannot delete object "${key}".`,
      );
    },
  };
}

export function getObjectStore(): ObjectStore {
  return isObjectStoreEnabled() ? r2ObjectStore() : disabledObjectStore();
}
