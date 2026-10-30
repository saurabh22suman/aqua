"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InstallRibbon } from "@/components/pwa/install-ribbon";
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
// Rules this component keeps (docs/design-system/pwa.md) plus the
// coordinator's browser review of 26 October 2026, which measured the
// previous card at 138px tall covering three of the nine visible member
// rows at 390x844:
//
//   * COMPACT — one row: the action and a dismissal. No paragraph, no
//     card, nothing that reads like a modal.
//   * NON-BLOCKING — the offer never blocks the page beneath it.
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
// The presentation is the side ribbon (30 October 2026, human request
// and docs/design/pwa-side-ribbon-20261030/ribbon-contract.md): a small
// tab on the right edge that opens the install options and folds back
// into the tab when the offer is over, instead of the offer simply
// disappearing. The ribbon owns the expand, collapse and move
// behaviour; this component owns the install POLICY, which has not
// changed: the 4s delay, the 10s visible duration, the month-long
// dismissal and the once-per-session marker all stay as they were.
//
// The decision itself lives in lib/offline/install-prompt.ts so it can
// be tested without a browser.

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
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [ribbonMounted, setRibbonMounted] = useState(false);
  const ribbonMountedRef = useRef(false);

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
  //
  // It arrives COLLAPSED. The independent Chrome review of 30 October
  // 2026 found that an opening panel covered the page's filters, and
  // that a collapsed ribbon which opened by itself also replayed that
  // opening when the device came back online. The ribbon now opens only
  // when the person asks for it.
  useEffect(() => {
    if (!offerable || !online || !surfaceAllowed) return;
    const alreadyShown = offerShownThisSession(window.sessionStorage);
    const timer = setTimeout(() => {
      if (!ribbonMountedRef.current) {
        ribbonMountedRef.current = true;
        setRibbonMounted(true);
      }
      if (!alreadyShown) rememberOfferShown(window.sessionStorage);
    }, INSTALL_OFFER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [offerable, online, surfaceAllowed]);

  useEffect(() => {
    if (!confirmationVisible) return;
    const timer = setTimeout(() => setConfirmationVisible(false), INSTALL_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [confirmationVisible]);

  const dismiss = useCallback(() => {
    writeInstallDismissal(window.localStorage, Date.now());
    rememberOfferShown(window.sessionStorage);
    setRibbonMounted(false);
    ribbonMountedRef.current = false;
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

  if (availability !== "browser-prompt" && availability !== "ios-guide") return null;
  if (!ribbonMounted) return null;

  return (
    <InstallRibbon
      availability={availability}
      onInstall={() => void install()}
      onDismiss={dismiss}
      visibleDurationMs={INSTALL_OFFER_VISIBLE_MS}
    />
  );
}

export { INSTALL_DISMISSAL_KEY, INSTALL_OFFER_SHOWN_KEY };
