const DB_NAME = "aqua-offline";
const DB_VERSION = 1;
const QUEUE = "queue";
const KV = "kv";

export type QueueEntry = {
  clientId: string;
  sessionId: string;
  memberId: string;
  status: "present" | "absent" | "late";
  savedAt: number;
  attempts: number;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) {
        db.createObjectStore(QUEUE, { keyPath: "clientId" });
      }
      if (!db.objectStoreNames.contains(KV)) {
        db.createObjectStore(KV);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    // A request's `onsuccess` means the operation was accepted into the
    // transaction — not that the transaction has committed. Resolving
    // here (as this used to) let a caller believe a write was durable
    // before it actually was; a reload landing in that gap could lose
    // it (issue #4). Capture the result, but only resolve on the
    // transaction's own `oncomplete`, which fires strictly after every
    // request in it has succeeded AND the transaction has committed.
    let result: T;
    req.onsuccess = () => {
      result = req.result as T;
    };
    req.onerror = () => reject(req.error);
    t.oncomplete = () => {
      db.close();
      resolve(result);
    };
    t.onerror = () => reject(t.error);
  });
}

export async function enqueueMark(entry: QueueEntry): Promise<void> {
  await tx(QUEUE, "readwrite", (s) => s.put(entry));
}

export async function queueAll(): Promise<QueueEntry[]> {
  const all = await tx<QueueEntry[]>(QUEUE, "readonly", (s) => s.getAll());
  return all.sort((a, b) => a.savedAt - b.savedAt);
}

export async function queueDelete(clientId: string): Promise<void> {
  await tx(QUEUE, "readwrite", (s) => s.delete(clientId));
}

export async function queueCount(): Promise<number> {
  return tx<number>(QUEUE, "readonly", (s) => s.count());
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  await tx(KV, "readwrite", (s) => s.put(value, key));
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const v = await tx<T>(KV, "readonly", (s) => s.get(key));
  return v ?? null;
}

export async function kvDelete(key: string): Promise<void> {
  await tx(KV, "readwrite", (s) => s.delete(key));
}
