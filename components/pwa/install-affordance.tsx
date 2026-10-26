"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  INSTALL_DISMISSAL_KEY,
  installAvailability,
  isInstallableSurface,
  readInstallDismissal,
  writeInstallDismissal,
  type InstallAvailability,
  type InstallPromptEvent,
} from "@/lib/offline/install-prompt";

// The honest install offer.
//
// Rules this component keeps (docs/design-system/pwa.md):
//   * it is an inline, dismissible banner — never a modal, never a
//     focus trap, never on top of the sign-in form;
//   * Chromium's own `beforeinstallprompt` event is the only thing that
//     can produce a real install button;
//   * iOS and iPadOS get accurate "Add to Home Screen" guidance, because
//     no browser on iOS fires an install event;
//   * a dismissal is remembered for a month, so nobody is nagged;
//   * it never renders on the operator console or on a signed parent
//     link — a parent link is a credential and must stay free of install
//     metadata.
//
// The decision itself lives in lib/offline/install-prompt.ts so it can be
// tested without a browser.

export type InstallAffordanceProps = {
  /** The current path; the offer is suppressed on ops and parent links. */
  pathname: string;
};

function isStandaloneWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch {
      // Older engines without the query: fall through to the legacy flag.
    }
  }
  const legacy = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return legacy === true;
}

export function InstallAffordance({ pathname }: InstallAffordanceProps) {
  const [availability, setAvailability] = useState<InstallAvailability>("unsupported");
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [online, setOnline] = useState(true);

  const surfaceAllowed = isInstallableSurface(pathname);

  const decide = useCallback(
    (browserPromptAvailable: boolean) => {
      if (!surfaceAllowed) {
        setAvailability("unsupported");
        return;
      }
      setAvailability(
        installAvailability({
          secureContext: typeof window !== "undefined" && window.isSecureContext === true,
          standalone: isStandaloneWindow(),
          userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
          browserPromptAvailable,
          dismissedAt: readInstallDismissal(window.localStorage),
          now: Date.now(),
        }),
      );
    },
    [surfaceAllowed],
  );

  useEffect(() => {
    if (!surfaceAllowed) {
      setAvailability("unsupported");
      return;
    }
    decide(false);

    // An install offer while the device is offline is noise: the page
    // is already telling the person they are offline.
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    const onBeforeInstall = (event: Event) => {
      // Keep the event so the offer can call prompt() later; without
      // preventDefault Chromium would show its own mini-infobar.
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      decide(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setAvailability("installed");
      // An installed app must never be offered again on this device.
      writeInstallDismissal(window.localStorage, Date.now());
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [decide, surfaceAllowed]);

  const dismiss = useCallback(() => {
    writeInstallDismissal(window.localStorage, Date.now());
    setAvailability("dismissed");
  }, []);

  const install = useCallback(async () => {
    const event = promptEvent;
    if (!event) return;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice?.outcome === "accepted") {
        setInstalled(true);
        setAvailability("installed");
        writeInstallDismissal(window.localStorage, Date.now());
        return;
      }
    } catch {
      // The browser refused (already installed, or the event was stale).
    }
    dismiss();
  }, [dismiss, promptEvent]);

  if (!surfaceAllowed || !online) return null;

  if (availability === "installed") {
    if (!installed) return null;
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 pb-3">
        <p className="pointer-events-auto rounded-pill bg-marine px-4 py-2 text-[13px] text-paper shadow-2">
          Aqua is installed.
        </p>
      </div>
    );
  }

  if (availability !== "browser-prompt" && availability !== "ios-guide") return null;

  // The 64px offset is the shell's bottom-navigation gutter (the same
  // one components/ui/StickyActionBar.tsx uses): the offer must never
  // cover the navigation.
  return (
    <section
      aria-label="Install Aqua"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 pb-3"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-card border border-line bg-paper p-4 shadow-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-snug text-ink-2">
          {availability === "ios-guide" ? (
            <>
              Add Aqua to your home screen for a faster start: tap{" "}
              <span className="font-medium text-ink">Share</span>, then{" "}
              <span className="font-medium text-ink">Add to Home Screen</span>.
            </>
          ) : (
            "Install Aqua for a home-screen shortcut and offline attendance."
          )}
        </p>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {availability === "browser-prompt" ? (
            <Button variant="primary" size="sm" onClick={() => void install()}>
              Install Aqua
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Not now
          </Button>
        </div>
      </div>
    </section>
  );
}

export { INSTALL_DISMISSAL_KEY };
