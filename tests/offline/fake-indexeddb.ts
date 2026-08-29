import { vi } from "vitest";

// A minimal, hand-rolled IndexedDB stand-in — not a general-purpose
// polyfill, just enough of the callback protocol lib/offline/idb.ts
// actually uses (open/transaction/objectStore/put/get/getAll/delete/
// count) to test one specific, real-world timing guarantee: a
// transaction's `oncomplete` fires strictly after any of its requests'
// `onsuccess`, because a request succeeding only means the operation
// was accepted, not that the transaction has committed.
//
// That ordering is enforced here via the event loop itself, not a
// flag: request success fires on a microtask, transaction completion
// fires on a macrotask (setTimeout 0), which is guaranteed by the spec
// to run after every already-queued microtask. This is what makes the
// test in idb-tx-durability.test.ts fail deterministically against
// today's tx() (which resolves on the microtask) and pass once tx()
// resolves on the macrotask instead — no real timing race involved.
export type FakeIdbHooks = {
  onRequestSuccess?: () => void;
  onTransactionComplete?: () => void;
};

type Row = Record<string, unknown>;

export function installFakeIndexedDB(hooks: FakeIdbHooks = {}): void {
  const stores = new Map<string, Map<string, Row | unknown>>();

  function makeRequest<T>(compute: () => T) {
    const req: { onsuccess: (() => void) | null; onerror: ((err?: unknown) => void) | null; result?: T } = {
      onsuccess: null,
      onerror: null,
    };
    queueMicrotask(() => {
      try {
        req.result = compute();
        hooks.onRequestSuccess?.();
        req.onsuccess?.();
      } catch (err) {
        req.onerror?.(err);
      }
    });
    return req;
  }

  function makeObjectStore(name: string, keyPath?: string) {
    const map = stores.get(name)!;
    return {
      put: (value: Row, key?: string) => makeRequest(() => {
        map.set(key ?? (keyPath ? (value[keyPath] as string) : String(value)), value);
        return undefined;
      }),
      get: (key: string) => makeRequest(() => map.get(key)),
      getAll: () => makeRequest(() => Array.from(map.values())),
      delete: (key: string) => makeRequest(() => {
        map.delete(key);
        return undefined;
      }),
      count: () => makeRequest(() => map.size),
    };
  }

  function makeTransaction(keyPaths: Map<string, string | undefined>) {
    const t: { oncomplete: (() => void) | null; onerror: ((err?: unknown) => void) | null } = {
      oncomplete: null,
      onerror: null,
    };
    // Macrotask: guaranteed by the JS event loop to run after every
    // microtask already queued at the time it's scheduled — including
    // the request's own onsuccess microtask above. This is the whole
    // mechanism the test relies on, not a hopeful delay.
    setTimeout(() => {
      hooks.onTransactionComplete?.();
      t.oncomplete?.();
    }, 0);
    return Object.assign(t, {
      objectStore: (name: string) => makeObjectStore(name, keyPaths.get(name)),
    });
  }

  const keyPaths = new Map<string, string | undefined>();

  const fakeDb = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, options?: { keyPath?: string }) => {
      stores.set(name, new Map());
      keyPaths.set(name, options?.keyPath);
    },
    transaction: () => makeTransaction(keyPaths),
    close: () => {},
  };

  const fakeIndexedDB = {
    open: () => {
      const req: {
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: ((err?: unknown) => void) | null;
        result: typeof fakeDb;
      } = { onupgradeneeded: null, onsuccess: null, onerror: null, result: fakeDb };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };

  vi.stubGlobal("indexedDB", fakeIndexedDB);
}
