"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  INSTALL_CONFIRMATION_MS,
  INSTALL_DISMISSAL_KEY,
  INSTALL_OFFER_DELAY_MS,
  INSTALL_OFFER_SHOWN_KEY,
  INSTALL_OFFER_VISIBLE_MS,
  installAvailability,
  isInstallInvitationSurface,
  offerShownThisSession,
  readInstallDismissal,
  rememberOfferShown,
  writeInstallDismissal,
  type InstallAvailability,
  type InstallPromptEvent,
} from "@/lib/offline/install-prompt";

// The install offer.
//
// Rules this component keeps (docs/design-system/pwa.md), plus the
// coordinator's browser review of 26 October 2026, which measured the
// previous card at 138px tall covering three of the nine visible member
// rows at 390x844:
//
//   * COMPACT — one row: the action and a dismissal. No paragraph, no
//     card, nothing that reads like a modal.
//   * NON-BLOCKING — the offer is pointer-transparent, so the page
//     beneath it stays fully usable, and it sits in the shell's
//     bottom-navigation gutter so it never covers the navigation.
//   * APPROPRIATELY TIMED — it arrives after a short delay, it leaves
//     again on its own, and it does not come back in the same session.
//     It is a nudge, not something that waits to be dismissed.
//   * CONTEXTUAL — Chromium's own `beforeinstallprompt` event is the
//     only thing that can produce a real install button; iOS and
//     iPadOS get accurate "Add to Home Screen" guidance, because no
//     browser on iOS fires an install event.
//   * NEVER A MODAL — no dialog role, no focus trap, no focus theft.
//   * NOT NAGGING — an explicit dismissal is remembered for a month.
//   * NEVER on the sign-in journey, the operator console, or a signed
//     parent link.
//
// The decision itself lives in lib/offline/install-prompt.ts so it can be
// tested without a browser.

export type InstallAffordanceProps = {
  /** The current path; the offer is suppressed on sign-in, ops and parent surfaces. */
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
  const [offerVisible, setOfferVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);

  const surfaceAllowed = isInstallInvitationSurface(pathname);
  const offerable = availability === "browser-prompt" || availability === "ios-guide";

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

  // The offer arrives late, so it never interrupts the first thing the
  // person came to do.
  useEffect(() => {
    if (!offerable || !online || !surfaceAllowed) return;
    if (offerShownThisSession(window.sessionStorage)) return;
    const timer = setTimeout(() => {
      setOfferVisible(true);
      rememberOfferShown(window.sessionStorage);
    }, INSTALL_OFFER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [offerable, online, surfaceAllowed]);

  // …and it leaves again on its own.
  useEffect(() => {
    if (!offerVisible) return;
    const timer = setTimeout(() => setOfferVisible(false), INSTALL_OFFER_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [offerVisible]);

  useEffect(() => {
    if (!confirmationVisible) return;
    const timer = setTimeout(() => setConfirmationVisible(false), INSTALL_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [confirmationVisible]);

  const dismiss = useCallback(() => {
    writeInstallDismissal(window.localStorage, Date.now());
    rememberOfferShown(window.sessionStorage);
    setOfferVisible(false);
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
        setConfirmationVisible(true);
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
    if (!installed || !confirmationVisible) return null;
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 flex justify-start px-4 pb-3">
        <p className="pointer-events-auto rounded-pill bg-marine px-4 py-2 text-[13px] text-paper shadow-2">
          Aqua is installed.
        </p>
      </div>
    );
  }

  if (!offerable || !offerVisible) return null;

  // The 64px offset is the shell's bottom-navigation gutter (the same
  // one components/ui/StickyActionBar.tsx uses): the offer must never
  // cover the navigation. The pill is bottom-LEFT and narrow, so it
  // never covers the row actions on the right of a list.
  return (
    <section
      aria-label="Install Aqua"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 flex justify-start px-4 pb-3"
    >
      <div className="pointer-events-auto flex w-fit max-w-[16rem] items-center gap-1 rounded-pill border border-line bg-paper py-1 pl-1 pr-1 shadow-2">
        {availability === "browser-prompt" ? (
          <Button variant="primary" size="sm" onClick={() => void install()}>
            Install Aqua
          </Button>
        ) : (
          <span className="px-2 text-[13px] leading-tight text-ink-2">
            Share ▸ Add to Home Screen
          </span>
        )}
        <button
          type="button"
          aria-label="Not now"
          onClick={dismiss}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-pill text-[15px] text-ink-3 hover:bg-deck hover:text-ink-2"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </section>
  );
}

export { INSTALL_DISMISSAL_KEY, INSTALL_OFFER_SHOWN_KEY };
