import { offlineCacheStateSchema, offlineSessionStateSchema } from "./identity";
import { clearOfflineStorage, storedOfflineIdentity } from "./idb";

export async function readOfflineSessionState() {
  const response = await fetch("/api/offline/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Could not verify the offline session.");
  return offlineSessionStateSchema.parse(await response.json());
}

let lifecycle: Promise<unknown> = Promise.resolve();
export function runOfflineLifecycle<T>(work: () => Promise<T>): Promise<T> {
  const next = lifecycle.then(work); lifecycle = next.catch(() => {}); return next;
}

export async function localOfflineScope(): Promise<string | null> {
  const active = await storedOfflineIdentity();
  if (active) return active.scope;
  if (!("caches" in window)) return null;
  const response = await (await caches.open("aqua-offline-state-v2")).match(new URL("/__aqua_offline_state", window.location.origin).href);
  const parsed = offlineCacheStateSchema.safeParse(response ? await response.json() : {});
  return parsed.success ? parsed.data.identity?.scope ?? parsed.data.blockedScope ?? null : null;
}

export async function clearOfflineData(expectedScope?: string | null): Promise<boolean> {
  const previous = await storedOfflineIdentity();
  let unregister = expectedScope === undefined;
  // Clear must reach the current controller even after unregister: it may
  // still control already-open tabs until their next navigation.
  const controller = navigator.serviceWorker?.controller;
  if (controller && typeof MessageChannel !== "undefined") {
    await new Promise<void>(resolve => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); resolve(); }, 3000);
      channel.port1.onmessage = () => { clearTimeout(timeout); channel.port1.close(); resolve(); };
      controller.postMessage({ type: "aqua-clear-offline", scope: expectedScope }, [channel.port2]);
    });
  }
  if (!await clearOfflineStorage(expectedScope)) return false;
  if (previous) window.dispatchEvent(new CustomEvent("aqua-offline-cleared", { detail: { scope: previous.scope } }));
  if ("caches" in window) {
    // Keep the controller's logout tombstone until a different server session
    // authenticates. Deleting it would allow an in-flight logout to re-cache.
    const meta = await caches.open("aqua-offline-state-v2");
    const key = new URL("/__aqua_offline_state", window.location.origin).href;
    const old = await meta.match(key);
    const parsed = offlineCacheStateSchema.safeParse(old ? await old.json() : {});
    if (expectedScope !== undefined) unregister = !parsed.success || !parsed.data.identity || parsed.data.identity.scope === expectedScope;
    const scope = previous?.scope ?? expectedScope;
    if (scope && (!parsed.success || !parsed.data.identity || parsed.data.identity.scope === scope)) {
      await meta.put(key, new Response(JSON.stringify({ blockedScope: scope })));
    }
    await Promise.all((await caches.keys()).filter(key => expectedScope === undefined
      ? key.startsWith("aqua-") && key !== "aqua-offline-state-v2"
      : key === "aqua-shell-v1" || (expectedScope && key === `aqua-private-v2-${expectedScope}`))
      .map(key => caches.delete(key)));
  }
  if (unregister && "serviceWorker" in navigator) {
    await Promise.all((await navigator.serviceWorker.getRegistrations()).map(registration => registration.unregister()));
  }
  return true;
}
