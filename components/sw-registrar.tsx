"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // The SW is served from the apex host only (middleware.ts keeps
    // /sw.js on the tenant surface). Registering it on ops.<base>
    // 404s and logs a console error on every console page; the ops
    // surface has no offline story, so skip it there.
    if (window.location.hostname.toLowerCase().startsWith("ops.")) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
