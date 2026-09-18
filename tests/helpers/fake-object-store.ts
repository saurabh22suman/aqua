import type { ObjectStore } from "@/lib/storage/object-store";

// In-memory ObjectStore for tests. E-03/E-06 jobs take a store
// parameter precisely so tests can inject this instead of reaching
// Cloudflare R2 over the network — no credentials, no HTTP, and the
// stored bytes stay inspectable.
export class FakeObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  putCalls = 0;

  async putObject(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    this.putCalls += 1;
    this.objects.set(key, { bytes: Uint8Array.from(bytes), contentType });
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    const object = this.objects.get(key);
    return object ? Uint8Array.from(object.bytes) : null;
  }
}
