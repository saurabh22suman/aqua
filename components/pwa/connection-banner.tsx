"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

// The offline truth.
//
// When the device is offline the app says so, and says what does not
// work: attendance keeps working (it is queued on the device and syncs
// later), while fees, staff and settings need a connection. Nothing
// here ever suggests a financial action succeeded offline.
//
// The banner is a plain inline region — never a modal, never a focus
// trap — and it can be dismissed for the rest of the visit.

export type ConnectionBannerProps = {
  /** The current path. The banner never appears on the ops surface. */
  pathname: string;
};

export function ConnectionBanner({ pathname }: ConnectionBannerProps) {
  const [online, setOnline] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const opsSurface = pathname === "/ops" || pathname.startsWith("/ops/");
  // The attendance register carries its own offline status ("You're
  // offline", the pending count, the last sync). A second floating
  // notice there would sit on top of the mark buttons at the bottom of
  // the roster — the one place the person is working while offline.
  const registerSurface = pathname.startsWith("/coach/register");

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (opsSurface || registerSurface || online || dismissed) return null;

  // The 64px offset is the shell's bottom-navigation gutter (the same
  // one components/ui/StickyActionBar.tsx uses): a floating notice must
  // never sit on top of the navigation it is meant to interrupt.
  //
  // The card itself is pointer-transparent so the page underneath stays
  // usable; only the Dismiss button takes clicks. A notice that blocks
  // the screen it is describing is a bug, not a notice.
  return (
    <section
      aria-label="Connection status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 pb-3"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-card border border-line bg-paper p-4 shadow-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-snug text-ink-2">
          You are offline. Attendance you mark is saved on this device and syncs when you
          reconnect. Fees, staff and settings need a connection.
        </p>
        <Button variant="ghost" size="sm" className="pointer-events-auto" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
