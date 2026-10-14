import type { OfflineIdentity } from "./identity";

const DB_NAME = "aqua-offline";
const DB_VERSION = 2;
const QUEUE = "queue", KV = "kv", IDENTITY = "identity";

export type QueueEntry = {
  clientId: string; sessionId: string; memberId: string; status: "present" | "absent" | "late";
  savedAt: number; attempts: number; scope?: string; expiresAt?: number;
};
type StoredIdentity = { active?: OfflineIdentity; blockedScope?: string };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      // Legacy rosters/queues have no proven identity and cannot be reused.
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        request.transaction?.objectStore(QUEUE).clear();
        request.transaction?.objectStore(KV).clear();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(stores: string | string[], mode: IDBTransactionMode,
  work: (tx: IDBTransaction, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    let failed: Error | undefined;
    tx.oncomplete = () => { db.close(); if (failed) reject(failed); else resolve(result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(failed ?? tx.error ?? new Error("Offline storage failed.")); };
    work(tx, value => { result = value; }, error => { failed = error; tx.abort(); });
  });
}

function requestValue<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return transaction<T>(store, mode, (tx, done) => {
    const request = work(tx.objectStore(store));
    request.onsuccess = () => done(request.result);
  });
}

export async function storedOfflineIdentity(): Promise<OfflineIdentity | null> {
  return (await kvGet<StoredIdentity>(IDENTITY))?.active ?? null;
}

export async function activateOfflineIdentity(identity: OfflineIdentity, expectedScope?: string | null): Promise<boolean> {
  return transaction<boolean>([QUEUE, KV], "readwrite", (tx, done) => {
    const kv = tx.objectStore(KV), queue = tx.objectStore(QUEUE);
    const request = kv.get(IDENTITY);
    request.onsuccess = () => {
      const previous = request.result as StoredIdentity | undefined;
      if (expectedScope !== undefined && previous?.active && previous.active.scope !== expectedScope && previous.active.scope !== identity.scope) {
        done(false); return;
      }
      if (identity.expiresAt <= Date.now() || previous?.blockedScope === identity.scope) { done(false); return; }
      if (previous?.active?.scope !== identity.scope) { queue.clear(); kv.clear(); }
      kv.put({ active: identity } satisfies StoredIdentity, IDENTITY);
      done(true);
    };
  });
}

export async function clearOfflineStorage(expectedScope?: string | null): Promise<boolean> {
  return transaction<boolean>([QUEUE, KV], "readwrite", (tx, done) => {
    const kv = tx.objectStore(KV), queue = tx.objectStore(QUEUE), request = kv.get(IDENTITY);
    request.onsuccess = () => {
      const previous = request.result as StoredIdentity | undefined;
      if (expectedScope !== undefined && previous?.active && previous.active.scope !== expectedScope) { done(false); return; }
      queue.clear(); kv.clear();
      const blockedScope = previous?.active?.scope ?? previous?.blockedScope;
      if (blockedScope) kv.put({ blockedScope } satisfies StoredIdentity, IDENTITY);
      done(true);
    };
  });
}

export async function enqueueMark(entry: QueueEntry): Promise<void> {
  await transaction<void>([QUEUE, KV], "readwrite", (tx, done, fail) => {
    const request = tx.objectStore(KV).get(IDENTITY);
    request.onsuccess = () => {
      const identity = (request.result as StoredIdentity | undefined)?.active;
      if (!identity || identity.scope !== entry.scope || identity.expiresAt <= Date.now() ||
        !entry.expiresAt || entry.expiresAt <= Date.now()) {
        fail(new Error("Your offline session ended. Sign in again before marking.")); return;
      }
      tx.objectStore(QUEUE).put(entry); done(undefined);
    };
  });
}

export async function scopedKvSet<T>(identity: OfflineIdentity, key: string, value: T): Promise<void> {
  await transaction<void>(KV, "readwrite", (tx, done, fail) => {
    const store = tx.objectStore(KV), request = store.get(IDENTITY);
    request.onsuccess = () => {
      const current = (request.result as StoredIdentity | undefined)?.active;
      if (!current || current.scope !== identity.scope || current.expiresAt <= Date.now()) {
        fail(new Error("Your offline session ended.")); return;
      }
      store.put(value, `${identity.scope}:${key}`); done(undefined);
    };
  });
}

export async function queueAll(): Promise<QueueEntry[]> {
  return (await requestValue<QueueEntry[]>(QUEUE, "readonly", store => store.getAll())).sort((a, b) => a.savedAt - b.savedAt);
}
export async function queueForIdentity(identity: OfflineIdentity): Promise<QueueEntry[]> {
  const active = await storedOfflineIdentity();
  if (!active || active.scope !== identity.scope || active.expiresAt <= Date.now()) return [];
  return (await queueAll()).filter(entry => entry.scope === identity.scope && (entry.expiresAt ?? 0) > Date.now());
}
export async function queueDelete(clientId: string): Promise<void> { await requestValue(QUEUE, "readwrite", store => store.delete(clientId)); }
export async function queueCount(): Promise<number> { return requestValue(QUEUE, "readonly", store => store.count()); }
export async function kvSet<T>(key: string, value: T): Promise<void> { await requestValue(KV, "readwrite", store => store.put(value, key)); }
export async function kvGet<T>(key: string): Promise<T | null> { return (await requestValue<T>(KV, "readonly", store => store.get(key))) ?? null; }
export async function kvDelete(key: string): Promise<void> { await requestValue(KV, "readwrite", store => store.delete(key)); }
