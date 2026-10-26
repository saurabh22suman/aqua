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

/** How often the page looks for a registration it can watch. */
const REGISTRATION_POLL_MS = 5_000;
/** How long it keeps looking before it stops (the page will look again
 *  on the next navigation). */
const REGISTRATION_POLL_ATTEMPTS = 24;

/** The registration of the worker that is installed and waiting. */
export function isWaitingRegistration(
  registration: ServiceWorkerRegistration | null | undefined,
): registration is ServiceWorkerRegistration {
  return Boolean(registration?.waiting);
}

/**
 * The registration for this origin, whether or not a new worker is
 * waiting yet.
 *
 * This used to answer only for a registration with a WAITING worker,
 * which meant the page could not attach its "updatefound" listener to a
 * registration that was simply up to date — and an update that
 * installed while the page stayed open was never offered.
 */
export async function findServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** How to stop watching. */
export type UpdateWatcher = { dispose: () => void };

/**
 * Watch a registration for a new worker and report when one is ready
 * to be offered.
 *
 * The browser fires "updatefound" while the new worker is still
 * INSTALLING; the worker only becomes the waiting one afterwards. So
 * the installing worker's state is watched as well. An update is ready
 * only when the registration actually exposes a waiting worker.
 *
 * `dispose` removes every listener this watcher added, from the exact
 * objects it added them to. A stale registration must not keep a
 * listener attached after the page moved on.
 */
export function watchForUpdate(
  registration: ServiceWorkerRegistration,
  onUpdateAvailable: () => void,
): UpdateWatcher {
  const stateCleanups: Array<() => void> = [];

  const onUpdateFound = () => {
    const installing = registration.installing;
    if (!installing) {
      if (registration.waiting) onUpdateAvailable();
      return;
    }
    const onStateChange = () => {
      // A worker's own states are parsed → installing → installed →
      // activating → activated; the browser exposes the installed one as
      // the registration's `waiting` worker. "installed" is therefore the
      // moment an update becomes available.
      if (installing.state === "installed" && registration.waiting === installing) {
        onUpdateAvailable();
      }
    };
    installing.addEventListener("statechange", onStateChange);
    stateCleanups.push(() => installing.removeEventListener("statechange", onStateChange));
  };

  registration.addEventListener("updatefound", onUpdateFound);
  // updatefound may have fired before the page attached its watcher.
  onUpdateFound();

  return {
    dispose: () => {
      registration.removeEventListener("updatefound", onUpdateFound);
      for (const cleanup of stateCleanups.splice(0)) cleanup();
    },
  };
}

/**
 * Look for a registration to watch, for a short while.
 *
 * The worker is registered by the app shell; on a first visit it does
 * not exist yet when this page mounts, and on a later visit it does.
 * The short poll covers the case where it is created while the page is
 * open (a sign-in, for instance) without leaving a timer running for
 * ever.
 */
export async function findRegistrationToWatch(
  onRegistration: (registration: ServiceWorkerRegistration) => void,
  shouldContinue: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < REGISTRATION_POLL_ATTEMPTS; attempt++) {
    if (!shouldContinue()) return;
    const registration = await findServiceWorkerRegistration();
    if (!shouldContinue()) return;
    if (registration) {
      onRegistration(registration);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, REGISTRATION_POLL_MS));
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
