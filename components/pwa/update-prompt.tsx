"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isSafeToReload, pendingOfflineWork, pendingWorkMessage } from "@/lib/offline/update-safety";
import {
  activateWaitingWorker,
  findWaitingRegistration,
  reloadAfterUpdate,
} from "@/lib/offline/service-worker-update";

// The update notice.
//
// A new worker version is offered, never applied: the person decides,
// and the handover only happens when nothing would be lost by it.
// Nothing here reloads on its own, and nothing appears on the operator
// console (the platform host does not even run this worker).

export type UpdatePromptProps = {
  /** The current path. The notice never appears on the ops surface. */
  pathname: string;
};

export function UpdatePrompt({ pathname }: UpdatePromptProps) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const handoverRequested = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const opsSurface = pathname === "/ops" || pathname.startsWith("/ops/");

  useEffect(() => {
    if (opsSurface) return;
    let disposed = false;
    let registrationListener: ((event: Event) => void) | null = null;

    const watch = async () => {
      const waiting = await findWaitingRegistration();
      if (disposed) return;
      setRegistration(waiting);
      if (!waiting) return;
      // A worker that installs while the page is open shows up here.
      registrationListener = () => {
        void findWaitingRegistration().then((next) => {
          if (!disposed && next) setRegistration(next);
        });
      };
      waiting.addEventListener("updatefound", registrationListener);
    };

    void watch();

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
      if (timer.current) clearTimeout(timer.current);
      if (registrationListener) registration?.removeEventListener("updatefound", registrationListener);
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
    };
  }, [opsSurface, registration]);

  const update = useCallback(async () => {
    if (!registration) return;
    const work = await pendingOfflineWork();
    if (!isSafeToReload(work)) {
      setNotice(pendingWorkMessage(work));
      return;
    }
    handoverRequested.current = true;
    activateWaitingWorker(registration);
    // If the new worker never takes control, say so instead of leaving
    // the person with a banner that does nothing.
    timer.current = setTimeout(() => {
      handoverRequested.current = false;
      setNotice("The update did not finish. Close the app and open it again.");
    }, 15_000);
  }, [registration]);

  if (opsSurface || dismissed || !registration) return null;

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
