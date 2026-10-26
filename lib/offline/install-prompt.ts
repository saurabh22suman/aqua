// Which install affordance, if any, may be shown.
//
// The rules (docs/design-system/pwa.md) are deliberately boring:
// one contextual, dismissible offer; the browser's own install event
// when it exists; accurate iOS guidance instead of a pretend button;
// and silence once the person has said no.
//
// Nothing here touches the network, the DOM or the database — the
// decision is a pure function of the environment so it can be tested
// without a browser.

/** Where the dismissal timestamp is remembered. */
export const INSTALL_DISMISSAL_KEY = "aqua.pwa.install.dismissed";

/** How long a dismissal is remembered. Long enough to stop nagging. */
export const INSTALL_DISMISSAL_DAYS = 30;
export const INSTALL_DISMISSAL_WINDOW_MS = INSTALL_DISMISSAL_DAYS * 24 * 60 * 60 * 1000;

/**
 * When the offer is remembered as "already shown" for this tab session.
 * A dismissal (localStorage) survives a month; this one only stops the
 * offer from ambushing the same person twice in one session.
 */
export const INSTALL_OFFER_SHOWN_KEY = "aqua.pwa.install.offered";

/**
 * The offer's timing. It arrives late enough that it does not ambush
 * the first interaction, and it leaves again on its own so it never
 * sits over the content waiting to be dismissed (the coordinator's
 * browser review measured the old offer covering three of nine visible
 * member rows at 390x844).
 */
export const INSTALL_OFFER_DELAY_MS = 4000;
export const INSTALL_OFFER_VISIBLE_MS = 10000;

/** How long the "installed" confirmation stays up. */
export const INSTALL_CONFIRMATION_MS = 4000;

export type InstallAvailability =
  | "browser-prompt" // Chromium offered its own install event
  | "ios-guide" // iOS/iPadOS: Add to Home Screen guidance
  | "installed" // already running as an installed app
  | "dismissed" // the offer was dismissed recently
  | "unsupported"; // nothing truthful can be offered

export type InstallEnvironment = {
  /** window.isSecureContext — service workers and install need HTTPS (or localhost). */
  secureContext: boolean;
  /** The app is already running standalone. */
  standalone: boolean;
  userAgent: string;
  /** The browser has already fired beforeinstallprompt. */
  browserPromptAvailable: boolean;
  /** When the offer was dismissed, if it was. */
  dismissedAt: number | null;
  now: number;
};

/** iOS and iPadOS, in any browser. */
export function isIosUserAgent(userAgent: string): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent) ||
    // iPadOS 13+ reports a desktop Safari user agent; the touch-point
    // count is the only honest signal there.
    (/Macintosh/i.test(userAgent) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
}

/**
 * Surfaces where an install offer makes sense. The operator console is
 * desktop-first and is not installable; a signed parent link is a
 * credential and must never carry install metadata.
 */
export function isInstallableSurface(pathname: string): boolean {
  if (!pathname) return true;
  if (pathname === "/ops" || pathname.startsWith("/ops/")) return false;
  if (pathname === "/p" || pathname.startsWith("/p/")) return false;
  return true;
}

/**
 * Surfaces where the install OFFER (the visible invitation) makes
 * sense. This is narrower than the surfaces that may carry the
 * manifest link:
 *
 *   * the sign-in journey — a person who has not signed in yet is
 *     trying to get in, not to install an app, and the offer must
 *     never sit on the sign-in form;
 *   * the operator console — not an installable app at all;
 *   * the parent surfaces — a parent link is a credential, and the
 *     signed-in parent home is a read-only view of one child.
 */
export function isInstallInvitationSurface(pathname: string): boolean {
  if (!isInstallableSurface(pathname)) return false;
  if (pathname === "/login" || pathname.startsWith("/login/")) return false;
  if (pathname === "/set-pin" || pathname.startsWith("/set-pin/")) return false;
  if (pathname === "/parent" || pathname.startsWith("/parent/")) return false;
  return true;
}

/** Has the offer already been shown in this tab session? */
export function offerShownThisSession(storage: Storage | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(INSTALL_OFFER_SHOWN_KEY) !== null;
  } catch {
    return false;
  }
}

/** Remember that the offer has been shown in this tab session. */
export function rememberOfferShown(storage: Storage | null | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(INSTALL_OFFER_SHOWN_KEY, String(Date.now()));
  } catch {
    // Storage failures are not worth an error.
  }
}

/** Has the dismissal aged out? */
export function dismissalExpired(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null) return true;
  return now - dismissedAt >= INSTALL_DISMISSAL_WINDOW_MS;
}

/** The one decision that decides what (if anything) the affordance shows. */
export function installAvailability(environment: InstallEnvironment): InstallAvailability {
  if (!environment.secureContext) return "unsupported";
  if (environment.standalone) return "installed";
  if (!dismissalExpired(environment.dismissedAt, environment.now)) return "dismissed";
  if (environment.browserPromptAvailable) return "browser-prompt";
  if (isIosUserAgent(environment.userAgent)) return "ios-guide";
  return "unsupported";
}

/** Read the remembered dismissal, tolerating a blocked/absent storage. */
export function readInstallDismissal(storage: Storage | null | undefined): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(INSTALL_DISMISSAL_KEY);
    if (!raw) return null;
    const at = Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Remember the dismissal. Storage failures are not worth an error. */
export function writeInstallDismissal(storage: Storage | null | undefined, at: number): void {
  if (!storage) return;
  try {
    storage.setItem(INSTALL_DISMISSAL_KEY, String(at));
  } catch {
    // Private mode / quota — the offer simply comes back later.
  }
}

/**
 * The Chromium install event. Not in the DOM lib (it is a Chromium
 * extension of the DOM), so it is described here instead of cast to
 * `any`.
 */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}
