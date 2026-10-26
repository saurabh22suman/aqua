"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isSafeToReload, pendingOfflineWork, pendingWorkMessage } from "@/lib/offline/update-safety";
import {
  activateWaitingWorker,
  findRegistrationToWatch,
  reloadAfterUpdate,
  watchForUpdate,
  type UpdateWatcher,
} from "@/lib/offline/service-worker-update";

// The update notice.
//
// A new worker version is offered, never applied: the person decides,
// and the handover only happens when nothing would be lost by it.
// Nothing here reloads on its own, and nothing appears on the operator
// console (the platform host does not even run this worker).
//
// Two things this has to get right, both found in review:
//
//   * the page must watch the registration even when no new worker is
//     waiting yet — otherwise an update that installs while the page
//     stays open is never offered;
//   * the browser fires "updatefound" while the new worker is still
//     installing, so the installing worker's state is what tells us
//     that an update is ready.
//
// Every listener is removed from the exact object it was added to when
// the page is left, so a stale registration cannot keep a listener
// attached.

export type UpdatePromptProps = {
  /** The current path. The notice never appears on the ops surface. */
  pathname: string;
};

export function UpdatePrompt({ pathname }: UpdatePromptProps) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const handoverRequested = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);

  const opsSurface = pathname === "/ops" || pathname.startsWith("/ops/");

  useEffect(() => {
    if (opsSurface) return;
    let disposed = false;
    let watcher: UpdateWatcher | null = null;

    const attach = (target: ServiceWorkerRegistration) => {
      if (disposed || watcher) return;
      registration.current = target;
      watcher = watchForUpdate(target, () => {
        if (!disposed) setUpdateAvailable(true);
      });
      if (target.waiting) setUpdateAvailable(true);
    };

    void findRegistrationToWatch(attach, () => !disposed);

    const onControllerChange = () => {
      if (!handoverRequested.current) return;
      handoverRequested.current = false;
      if (timer.current) clearTimeout(timer.current);
      reloadAfterUpdate();
    };
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }

    return () => {
      disposed = true;
      watcher?.dispose();
      watcher = null;
      if (timer.current) clearTimeout(timer.current);
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
    };
  }, [opsSurface, pathname]);

  const update = useCallback(async () => {
    const target = registration.current;
    if (!target) return;
    const work = await pendingOfflineWork();
    if (!isSafeToReload(work)) {
      setNotice(pendingWorkMessage(work));
      return;
    }
    handoverRequested.current = true;
    activateWaitingWorker(target);
    // If the new worker never takes control, say so instead of leaving
    // the person with a banner that does nothing.
    timer.current = setTimeout(() => {
      handoverRequested.current = false;
      setNotice("The update did not finish. Close the app and open it again.");
    }, 15_000);
  }, []);

  if (opsSurface || dismissed || !updateAvailable) return null;

  return (
    <section
      aria-label="App update"
      className="pointer-events-none fixed inset-x-0 top-[calc(64px+env(safe-area-inset-top))] z-40 flex justify-center px-4 pt-3"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-card border border-line bg-paper p-4 shadow-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-snug text-ink-2">
          {notice ?? "A new version of Aqua is ready. Update when you have a moment."}
        </p>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => void update()}>
            Update now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDismissed(true);
              setNotice(null);
            }}
          >
            Later
          </Button>
        </div>
      </div>
    </section>
  );
}
