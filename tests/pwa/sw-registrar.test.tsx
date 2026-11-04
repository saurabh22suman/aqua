// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeIndexedDB } from "../offline/fake-indexeddb";

// The registrar's boundary:
//   * the operator console never runs the tenant worker;
//   * a tenant surface registers it once the session is known;
//   * a signed-out visitor gets no worker at all.
//
// Agent-owned file (tests/pwa/**).

const { pathnameRef } = vi.hoisted(() => ({ pathnameRef: { current: "/coach" } }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameRef.current }));

import { ServiceWorkerRegistrar } from "@/components/sw-registrar";
import { INSTALL_OFFER_DELAY_MS } from "@/lib/offline/install-prompt";

const register = vi.fn(async () => ({ active: { postMessage: vi.fn() } }));

function installFakeServiceWorker() {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      register,
      ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
      controller: null,
      getRegistrations: async () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
}

function installFakeSession(authenticated: boolean, options: { offlineIdentity?: boolean } = {}) {
  const offlineIdentity = options.offlineIdentity ?? authenticated;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          authenticated,
          identity:
            authenticated && offlineIdentity
              ? { scope: "a".repeat(64), expiresAt: Date.now() + 3_600_000 }
              : null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}

beforeEach(() => {
  register.mockClear();
  installFakeIndexedDB();
  installFakeServiceWorker();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  pathnameRef.current = "/coach";
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the service worker registrar", () => {
  it("never runs the tenant worker on the operator console", async () => {
    pathnameRef.current = "/ops";
    installFakeSession(true);
    render(<ServiceWorkerRegistrar />);
    await new Promise(resolve => setTimeout(resolve, 30));
    // Nothing is registered and the offline identity endpoint is never
    // even asked: the operator console shares no storage with a tenant.
    expect(register).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("registers the worker on a tenant surface once the session is known", async () => {
    installFakeSession(true);
    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js"));
  });

  it("does not register a worker for a signed-out visitor", async () => {
    installFakeSession(false);
    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(register).not.toHaveBeenCalled();
  });

  it("registers the worker for a signed-in role that has no offline identity", async () => {
    // An owner or a receptionist has no offline attendance scope, but
    // the tenant app is still installable for them: Chromium only
    // offers installation when a worker with a fetch handler is
    // registered. Nothing offline is cached for such a session — the
    // offline cache stays identity-scoped.
    installFakeSession(true, { offlineIdentity: false });
    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js"));
  });

  it("mounts the install offer and the offline truth with the worker", async () => {
    vi.useFakeTimers();
    installFakeSession(true);
    render(<ServiceWorkerRegistrar />);

    // The browser offers an install… the offer itself arrives after a
    // short delay, so that it never interrupts the first thing the
    // person came to do.
    fireEvent(window, new Event("beforeinstallprompt"));
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    // Human revision: the native install action is the side shortcut itself.
    expect(screen.getByRole("button", { name: /^install aqua$/i })).toBeTruthy();

    // …and when the connection drops, the page says so.
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    fireEvent(window, new Event("offline"));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText(/you are offline/i)).toBeTruthy();
  });
});
