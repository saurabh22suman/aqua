"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { activateOfflineIdentity, storedOfflineIdentity } from "@/lib/offline/idb";
import { clearOfflineData, localOfflineScope, readOfflineSessionState, runOfflineLifecycle } from "@/lib/offline/client-session";
import { ConnectionBanner } from "@/components/pwa/connection-banner";
import { InstallAffordance } from "@/components/pwa/install-affordance";
import { ManifestLink } from "@/components/pwa/manifest-link";
import { UpdatePrompt } from "@/components/pwa/update-prompt";

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
    // Registering the worker is what makes the tenant app installable:
    // Chromium only offers installation when a worker with a fetch
    // handler is registered for the origin. The worker itself caches
    // nothing without an offline identity, so a signed-in role without
    // one (owner, reception) gets an installable app and no offline
    // copy of anything.
    async function registerWorker() {
      const registration = await navigator.serviceWorker.register("/sw.js");
      registration.active?.postMessage({ type: "aqua-refresh-offline" });
      void navigator.serviceWorker.ready.then(ready => {
        if (!disposed) ready.active?.postMessage({ type: "aqua-refresh-offline" });
      });
    }
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
          if (!state.authenticated) {
            if (window.location.pathname.startsWith("/coach")) window.location.replace("/login");
            return;
          }
          // Signed in, but this role has no offline attendance scope.
          // The worker still registers so the app stays installable; it
          // holds no identity and caches nothing.
          await registerWorker();
          return;
        }
        if (!await activateOfflineIdentity(state.identity, previousScope)) {
          const active = await storedOfflineIdentity();
          if (active && active.scope !== state.identity.scope && !disposed) void refresh();
          return;
        }
        window.dispatchEvent(new CustomEvent("aqua-offline-identity", { detail: { scope: state.identity.scope } }));
        await registerWorker();
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
  // The installable-app surfaces ride with the worker: the manifest
  // link that makes the tenant surface installable, the offer to
  // install, the notice when a new version is ready, and the plain
  // truth about the connection. Each one refuses the operator console
  // and a signed parent link on its own (see components/pwa/**).
  return (
    <>
      <ManifestLink pathname={pathname} />
      <InstallAffordance pathname={pathname} />
      <UpdatePrompt pathname={pathname} />
      <ConnectionBanner pathname={pathname} />
    </>
  );
}
