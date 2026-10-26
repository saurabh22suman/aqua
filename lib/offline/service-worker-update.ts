// The service worker's update handshake.
//
// The rules (docs/design-system/pwa.md):
//   * a new worker version waits — it never takes over on its own;
//   * the page asks for the handover explicitly, and only after the
//     person accepted it and nothing is pending;
//   * the reload happens when the new worker has actually taken
//     control, so the page is served by the version it asked for.
//
// public/sw.js answers ACTIVATE_UPDATE_MESSAGE with skipWaiting().

export const ACTIVATE_UPDATE_MESSAGE = "aqua-activate-update";

/** The registration of the worker that is installed and waiting. */
export function isWaitingRegistration(
  registration: ServiceWorkerRegistration | null | undefined,
): registration is ServiceWorkerRegistration {
  return Boolean(registration?.waiting);
}

/** The waiting worker, if there is one. */
export async function findWaitingRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return isWaitingRegistration(registration) ? registration : null;
  } catch {
    return null;
  }
}

/** Ask the waiting worker to take over. */
export function activateWaitingWorker(registration: ServiceWorkerRegistration): void {
  registration.waiting?.postMessage({ type: ACTIVATE_UPDATE_MESSAGE });
}

/** Reload the page onto the worker that just took control. */
export function reloadAfterUpdate(): void {
  window.location.reload();
}
