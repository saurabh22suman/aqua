import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// A small, honest harness for public/sw.js.
//
// The worker is a classic script, so it is evaluated in a VM context
// with fake browser globals: caches, fetch, clients, registration,
// indexedDB and the event objects. Nothing about the worker's logic is
// re-implemented here — the real file runs.
//
// Agent-owned helper (tests/pwa/**).

export type FakeWorkerIdentity = { scope: string; expiresAt: number };

export type HarnessOptions = {
  origin?: string;
  /** Whether a worker is already active (an update rather than a first install). */
  activeWorker?: boolean;
  identity?: FakeWorkerIdentity | null;
};

type Listener = (event: WorkerEvent) => void;

type WorkerEvent = {
  request?: unknown;
  data?: unknown;
  ports?: unknown[];
  source?: unknown;
  respondWith?: (response: Promise<Response>) => void;
  waitUntil: (promise: Promise<unknown>) => void;
};

class FakeCache {
  readonly entries = new Map<string, { url: string; response: Response }>();

  constructor(readonly name: string) {}

  async put(request: unknown, response: Response): Promise<void> {
    const url = typeof request === "string" ? request : String((request as { url: string }).url);
    this.entries.set(url, { url, response });
  }

  async match(request: unknown, options?: { ignoreVary?: boolean; ignoreSearch?: boolean }): Promise<Response | undefined> {
    const url = typeof request === "string" ? request : String((request as { url: string }).url);
    const exact = this.entries.get(url);
    if (exact) return exact.response.clone();
    if (options?.ignoreSearch) {
      const bare = url.split("?")[0];
      for (const entry of this.entries.values()) {
        if (entry.url.split("?")[0] === bare) return entry.response.clone();
      }
    }
    return undefined;
  }

  async keys(): Promise<Array<{ url: string }>> {
    return Array.from(this.entries.values()).map(entry => ({ url: entry.url }));
  }

  async delete(request: unknown): Promise<boolean> {
    const url = typeof request === "string" ? request : String((request as { url: string }).url);
    return this.entries.delete(url);
  }
}

function fakeIndexedDb(): unknown {
  const store = {
    get: () => {
      const request: { onsuccess: (() => void) | null; result?: unknown; onerror: (() => void) | null } = {
        onsuccess: null,
        onerror: null,
        result: undefined,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    clear: () => ({}),
    put: () => ({}),
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const transaction: { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; abort: () => void } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort: () => {},
      };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return Object.assign(transaction, { objectStore: () => store });
    },
    close: () => {},
  };
  return {
    open: () => {
      const request: { onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; onerror: (() => void) | null; result: unknown } = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        result: db,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}

export type Harness = {
  dispatchInstall(): Promise<void>;
  dispatchActivate(): Promise<void>;
  dispatchMessage(data: unknown): Promise<void>;
  dispatchFetch(request: { url: string; method?: string; mode?: string }): Promise<{
    responded: boolean;
    response?: Response;
  }>;
  /** The cache names the worker currently holds. */
  cacheNames(): string[];
  cacheEntries(name: string): string[];
  seedCache(name: string, url: string, response: Response): Promise<void>;
  setOffline(offline: boolean): void;
  setIdentity(identity: FakeWorkerIdentity | null): void;
  skipWaitingCalls: () => number;
  fetchLog: string[];
};

export function createHarness(options: HarnessOptions = {}): Harness {
  const origin = options.origin ?? "https://aqua.example";
  const listeners = new Map<string, Listener[]>();
  const cacheStorage = new Map<string, FakeCache>();
  const fetchLog: string[] = [];
  let offline = false;
  let identity: FakeWorkerIdentity | null =
    options.identity === undefined ? { scope: "a".repeat(64), expiresAt: Date.now() + 3_600_000 } : options.identity;
  let skipWaitingCalls = 0;

  const caches = {
    open: async (name: string) => {
      let cache = cacheStorage.get(name);
      if (!cache) {
        cache = new FakeCache(name);
        cacheStorage.set(name, cache);
      }
      return cache;
    },
    keys: async () => Array.from(cacheStorage.keys()),
    delete: async (name: string) => cacheStorage.delete(name),
    match: async (request: unknown) => {
      for (const cache of cacheStorage.values()) {
        const hit = await cache.match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const fakeFetch = async (input: unknown): Promise<Response> => {
    const raw = typeof input === "string" ? input : String((input as { url: string }).url);
    // The worker fetches same-origin paths relatively; resolve them the
    // way the browser would.
    const url = new URL(raw, origin).href;
    fetchLog.push(url);
    if (offline) throw new Error("offline");
    if (url.startsWith(origin + "/api/offline/session")) {
      return new Response(JSON.stringify({ authenticated: Boolean(identity), identity }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith(origin + "/_next/static/")) {
      return new Response("console.log(1)", { headers: { "Content-Type": "application/javascript" } });
    }
    if (url.startsWith(origin + "/coach")) {
      return new Response("<!doctype html><html><body><main>register</main></body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  };

  const self = {
    addEventListener: (type: string, listener: Listener) => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    location: { origin },
    registration: { active: options.activeWorker === false ? null : { state: "activated" } },
    clients: { matchAll: async () => [], claim: async () => {} },
    skipWaiting: async () => {
      skipWaitingCalls++;
    },
  };

  const context = createContext({
    self,
    caches,
    fetch: fakeFetch,
    indexedDB: fakeIndexedDb(),
    Response,
    Request,
    Headers,
    URL,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
  });
  runInContext(readFileSync("public/sw.js", "utf8"), context);

  const run = async (type: string, event: Partial<WorkerEvent>): Promise<WorkerEvent> => {
    const waits: Array<Promise<unknown>> = [];
    const full: WorkerEvent = {
      ...event,
      waitUntil: promise => {
        waits.push(promise);
      },
    };
    for (const listener of listeners.get(type) ?? []) listener(full);
    await Promise.all(waits);
    return full;
  };

  return {
    dispatchInstall: () => run("install", {}).then(() => undefined),
    dispatchActivate: () => run("activate", {}).then(() => undefined),
    dispatchMessage: async data => {
      await run("message", { data, ports: [], source: null });
    },
    dispatchFetch: async request => {
      let responsePromise: Promise<Response> | null = null;
      const waits: Array<Promise<unknown>> = [];
      const event: WorkerEvent = {
        request,
        respondWith: response => {
          responsePromise = response;
        },
        waitUntil: promise => {
          waits.push(promise);
        },
      };
      for (const listener of listeners.get("fetch") ?? []) listener(event);
      if (!responsePromise) {
        await Promise.all(waits);
        return { responded: false };
      }
      const response = await responsePromise;
      await Promise.all(waits);
      return { responded: true, response };
    },
    cacheNames: () => Array.from(cacheStorage.keys()),
    cacheEntries: name => Array.from(cacheStorage.get(name)?.entries.values() ?? []).map(entry => entry.url),
    seedCache: async (name, url, response) => {
      const cache = await caches.open(name);
      await cache.put(url, response);
    },
    setOffline: value => {
      offline = value;
    },
    setIdentity: value => {
      identity = value;
    },
    skipWaitingCalls: () => skipWaitingCalls,
    fetchLog,
  };
}

/** A navigation-shaped request. */
export function navigation(path: string): { url: string; method: string; mode: string } {
  return { url: `https://aqua.example${path}`, method: "GET", mode: "navigate" };
}
