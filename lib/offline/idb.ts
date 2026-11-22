import type { OfflineIdentity } from "./identity";
import {
  QUEUE_ENTRY_REFUSED,
  offlineQueueEntrySchema,
  type OfflineQueueEntry,
} from "./queue-schema";

const DB_NAME = "aqua-offline";
const DB_VERSION = 2;
const QUEUE = "queue", KV = "kv", IDENTITY = "identity";

/**
 * One queued attendance mark. The shape is validated with Zod before it
 * is stored: the offline queue may hold nothing but attendance, so a
 * forged or malformed entry is refused at the door instead of becoming
 * a second, offline copy of something else.
 */
export type QueueEntry = OfflineQueueEntry;
type StoredIdentity = { active?: OfflineIdentity; blockedScope?: string; blockedUntil?: number };

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
  return transaction<OfflineIdentity | null>(KV, "readwrite", (tx, done) => {
    const store = tx.objectStore(KV), request = store.get(IDENTITY);
    request.onsuccess = () => {
      const value = request.result as StoredIdentity | undefined;
      if (!value?.active && value?.blockedUntil && value.blockedUntil <= Date.now()) store.delete(IDENTITY);
      done(value?.active ?? null);
    };
  });
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
      // Unknown-expiry legacy revocations outlive cached components. Only the
      // server-verified lifecycle transition can replace one with a new scope.
      if (previous?.blockedScope && !previous.blockedUntil &&
        (expectedScope === undefined || (expectedScope !== null && expectedScope !== previous.blockedScope))) {
        done(false); return;
      }
      if (previous?.active?.scope !== identity.scope) {
        const count = queue.count(), notice = kv.get("attendance-loss-notice");
        notice.onsuccess = () => {
          const prior = notice.result as { count?: unknown } | undefined;
          const priorCount = typeof prior?.count === "number" && Number.isSafeInteger(prior.count) && prior.count > 0 ? prior.count : 0;
          const lost = priorCount + count.result;
          queue.clear(); kv.clear();
          if (lost) kv.put({ count: lost }, "attendance-loss-notice");
          kv.put({ active: identity } satisfies StoredIdentity, IDENTITY);
          done(true);
        };
      } else { kv.put({ active: identity } satisfies StoredIdentity, IDENTITY); done(true); }
    };
  });
}

export async function clearOfflineStorage(expectedScope?: string | null): Promise<boolean> {
  return transaction<boolean>([QUEUE, KV], "readwrite", (tx, done) => {
    const kv = tx.objectStore(KV), queue = tx.objectStore(QUEUE), request = kv.get(IDENTITY);
    request.onsuccess = () => {
      const previous = request.result as StoredIdentity | undefined;
      if (expectedScope !== undefined && previous?.active && previous.active.scope !== expectedScope) { done(false); return; }
      const count = queue.count(), notice = kv.get("attendance-loss-notice");
      notice.onsuccess = () => {
        const prior = notice.result as { count?: unknown } | undefined;
        const priorCount = typeof prior?.count === "number" && Number.isSafeInteger(prior.count) && prior.count > 0 ? prior.count : 0;
        const lost = priorCount + count.result;
        queue.clear(); kv.clear();
        if (lost) kv.put({ count: lost }, "attendance-loss-notice");
        const active = previous?.active;
        const blockedScope = active && active.expiresAt > Date.now() ? active.scope
          : previous?.blockedScope && (!previous.blockedUntil || previous.blockedUntil > Date.now()) ? previous.blockedScope : undefined;
        const blockedUntil = active && active.expiresAt > Date.now() ? active.expiresAt : previous?.blockedUntil;
        if (blockedScope) kv.put({ blockedScope, blockedUntil } satisfies StoredIdentity, IDENTITY);
        done(true);
      };
    };
  });
}

export async function enqueueMark(entry: QueueEntry): Promise<void> {
  const parsed = offlineQueueEntrySchema.safeParse(entry);
  if (!parsed.success) throw new Error(QUEUE_ENTRY_REFUSED);
  const mark = parsed.data;
  await transaction<void>([QUEUE, KV], "readwrite", (tx, done, fail) => {
    const request = tx.objectStore(KV).get(IDENTITY);
    request.onsuccess = () => {
      const identity = (request.result as StoredIdentity | undefined)?.active;
      if (!identity || identity.scope !== mark.scope || identity.expiresAt <= Date.now() ||
        mark.expiresAt <= Date.now()) {
        fail(new Error("Your offline session ended. Sign in again before marking.")); return;
      }
      const queue = tx.objectStore(QUEUE), existing = queue.get(mark.clientId);
      existing.onsuccess = () => {
        if (existing.result) {
          if (existing.result.scope !== mark.scope) { fail(new Error("Your offline session ended.")); return; }
          queue.put({ ...mark, order: existing.result.order }); done(undefined); return;
        }
        const kv = tx.objectStore(KV), counter = kv.get(`${mark.scope}:queue-order`);
        counter.onsuccess = () => {
          const last = typeof counter.result === "number" && Number.isSafeInteger(counter.result) && counter.result >= 0 ? counter.result : 0;
          if (last >= Number.MAX_SAFE_INTEGER) { fail(new Error("Offline queue is full.")); return; }
          const order = last + 1;
          kv.put(order, `${mark.scope}:queue-order`); queue.put({ ...mark, order }); done(undefined);
        };
      };
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
  return (await requestValue<QueueEntry[]>(QUEUE, "readonly", store => store.getAll())).sort((a, b) =>
    a.order === undefined ? (b.order === undefined ? a.savedAt - b.savedAt : -1)
      : b.order === undefined ? 1 : a.order - b.order);
}
export async function queueForIdentity(identity: OfflineIdentity): Promise<QueueEntry[]> {
  const active = await storedOfflineIdentity();
  if (!active || active.scope !== identity.scope || active.expiresAt <= Date.now()) return [];
  return (await queueAll()).filter(entry => entry.scope === identity.scope && (entry.expiresAt ?? 0) > Date.now());
}
export async function queueDelete(clientId: string): Promise<void> { await requestValue(QUEUE, "readwrite", store => store.delete(clientId)); }
export async function scopedQueueDelete(identity: OfflineIdentity, clientId: string): Promise<boolean> {
  return transaction<boolean>([QUEUE, KV], "readwrite", (tx, done) => {
    const request = tx.objectStore(KV).get(IDENTITY);
    request.onsuccess = () => {
      const active = (request.result as StoredIdentity | undefined)?.active;
      if (!active || active.scope !== identity.scope || active.expiresAt <= Date.now()) { done(false); return; }
      const queue = tx.objectStore(QUEUE), entry = queue.get(clientId);
      entry.onsuccess = () => {
        if (entry.result?.scope !== identity.scope) { done(false); return; }
        queue.delete(clientId); done(true);
      };
    };
  });
}
export async function queueCount(): Promise<number> { return requestValue(QUEUE, "readonly", store => store.count()); }
export async function kvSet<T>(key: string, value: T): Promise<void> { await requestValue(KV, "readwrite", store => store.put(value, key)); }
export async function kvGet<T>(key: string): Promise<T | null> { return (await requestValue<T>(KV, "readonly", store => store.get(key))) ?? null; }
export async function kvDelete(key: string): Promise<void> { await requestValue(KV, "readwrite", store => store.delete(key)); }
