"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { activateOfflineIdentity, storedOfflineIdentity } from "@/lib/offline/idb";
import { clearOfflineData, localOfflineScope, readOfflineSessionState, runOfflineLifecycle } from "@/lib/offline/client-session";

export function ServiceWorkerRegistrar() {
  const pathname = usePathname();
  useEffect(() => {
    // The platform (ops) surface must never run the offline service
    // worker: the worker caches the tenant surface, and the platform
    // host is a separate origin whose storage is separate anyway.
    //
    // The guard is path-based, not host-based, because the browser
    // cannot read OPS_HOST — it is a server-only variable, and the
    // image is built once in CI and then deployed to more than one
    // host. The platform host serves ONLY /ops/* (middleware.ts), so
    // the path is the one signal that is correct on every deployment
    // without any build-time configuration.
    if (!("serviceWorker" in navigator) || pathname.startsWith("/ops")) return;
    let revision = 0, disposed = false;
    async function refresh() {
      const request = ++revision;
      await runOfflineLifecycle(async () => { try {
        if (disposed || request !== revision) return;
        const previous = await storedOfflineIdentity();
        const previousScope = await localOfflineScope();
        if (previous && previous.expiresAt <= Date.now()) await clearOfflineData(previous.scope);
        if (!navigator.onLine) return;
        const state = await readOfflineSessionState();
        if (disposed || request !== revision) return;
        if (!state.identity) {
          if (!await clearOfflineData(previousScope)) return;
          window.dispatchEvent(new CustomEvent("aqua-offline-identity", { detail: { scope: null } }));
          if (!state.authenticated && window.location.pathname.startsWith("/coach")) window.location.replace("/login");
          return;
        }
        if (!await activateOfflineIdentity(state.identity, previousScope)) {
          const active = await storedOfflineIdentity();
          if (active && active.scope !== state.identity.scope && !disposed) void refresh();
          return;
        }
        window.dispatchEvent(new CustomEvent("aqua-offline-identity", { detail: { scope: state.identity.scope } }));
        const registration = await navigator.serviceWorker.register("/sw.js");
        registration.active?.postMessage({ type: "aqua-refresh-offline" });
        void navigator.serviceWorker.ready.then(ready => {
          if (!disposed) ready.active?.postMessage({ type: "aqua-refresh-offline" });
        });
      } catch {
        // An outage retains only the already-authorized, unexpired scope.
        // Expired/revoked sessions are cleared on the next successful check.
      } });
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 30_000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const message = (event: MessageEvent) => {
      if (event.data?.type === "aqua-offline-cleared") {
        window.dispatchEvent(new CustomEvent("aqua-offline-cleared", { detail: { scope: event.data.scope } }));
      }
    };
    navigator.serviceWorker.addEventListener("message", message);
    window.addEventListener("online", refresh); window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; revision++; clearInterval(interval);
      window.removeEventListener("online", refresh); window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", visible);
      navigator.serviceWorker.removeEventListener("message", message); };
  }, [pathname]);
  return null;
}
