// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallAffordance } from "@/components/pwa/install-affordance";
import { INSTALL_DISMISSAL_KEY } from "@/lib/offline/install-prompt";

// The install UX contract (docs/design-system/pwa.md):
//   * contextual and dismissible — never a login-blocking modal;
//   * Chromium's own install event is used when the browser offers one;
//   * iOS/iPadOS get accurate Add to Home Screen guidance instead of a
//     button that pretends to install;
//   * no repeated nagging, and nothing on the operator console or a
//     signed parent link.
//
// Agent-owned file (tests/pwa/**).

class FakeInstallPromptEvent extends Event {
  prompt = vi.fn(async () => {});
  userChoice = Promise.resolve({ outcome: "accepted" as const });
}

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  setUserAgent(
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  );
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the install affordance", () => {
  it("offers nothing before the browser can actually install", () => {
    const { container } = render(<InstallAffordance pathname="/owner" />);
    expect(container.textContent?.trim()).toBe("");
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("uses the browser's own install event when Chromium offers one", async () => {
    render(<InstallAffordance pathname="/owner" />);
    const event = new FakeInstallPromptEvent("beforeinstallprompt");
    fireEvent(window, event);

    const button = await screen.findByRole("button", { name: /^install aqua$/i });
    fireEvent.click(button);

    expect(event.prompt).toHaveBeenCalledTimes(1);
    await screen.findByText(/installed/i);
  });

  it("gives iOS accurate Add to Home Screen guidance instead of a fake install button", () => {
    setUserAgent(IPHONE_UA);
    render(<InstallAffordance pathname="/coach" />);

    expect(screen.getByText(/add to home screen/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
  });

  it("does not nag again after the offer is dismissed", async () => {
    const first = render(<InstallAffordance pathname="/owner" />);
    fireEvent(window, new FakeInstallPromptEvent("beforeinstallprompt"));
    fireEvent.click(await screen.findByRole("button", { name: /not now/i }));
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
    first.unmount();

    render(<InstallAffordance pathname="/owner" />);
    fireEvent(window, new FakeInstallPromptEvent("beforeinstallprompt"));
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
    expect(window.localStorage.getItem(INSTALL_DISMISSAL_KEY)).toBeTruthy();
  });

  it("never appears on the operator console or on a signed parent link", () => {
    const ops = render(<InstallAffordance pathname="/ops" />);
    expect(ops.container.textContent?.trim()).toBe("");
    ops.unmount();

    const parent = render(<InstallAffordance pathname="/p/9f2c-secret-token" />);
    expect(parent.container.textContent?.trim()).toBe("");
    parent.unmount();

    // The tenant sign-in screen may offer the install — it is where a
    // staff member opens the app on a phone — but only as a dismissible,
    // non-blocking offer.
    const login = render(<InstallAffordance pathname="/login" />);
    fireEvent(window, new FakeInstallPromptEvent("beforeinstallprompt"));
    expect(login.queryByRole("button", { name: /^install aqua$/i })).toBeTruthy();
    expect(login.queryByRole("button", { name: /not now/i })).toBeTruthy();
    expect(login.container.querySelector("[role='dialog']")).toBeNull();
  });

  it("stays out of the way of the page: no modal, no focus theft", async () => {
    render(
      <div>
        <main>
          <h1>Owner home</h1>
        </main>
        <InstallAffordance pathname="/owner" />
      </div>,
    );
    const before = document.activeElement;
    fireEvent(window, new FakeInstallPromptEvent("beforeinstallprompt"));
    await screen.findByRole("button", { name: /^install aqua$/i });

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[aria-modal='true']")).toBeNull();
    expect(document.activeElement).toBe(before);
    expect(screen.getByRole("heading", { name: /owner home/i })).toBeTruthy();
  });

  it("does not offer installation outside a secure context", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const { container } = render(<InstallAffordance pathname="/owner" />);
    fireEvent(window, new FakeInstallPromptEvent("beforeinstallprompt"));
    expect(container.textContent?.trim()).toBe("");
  });

  it("waits for a connection before offering an install", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    render(<InstallAffordance pathname="/owner" />);
    fireEvent(window, new FakeInstallPromptEvent("beforeinstallprompt"));
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();

    // The device comes back online: now the offer may be made.
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    fireEvent(window, new Event("online"));
    expect(await screen.findByRole("button", { name: /^install aqua$/i })).toBeTruthy();
  });

  it("stays quiet when the app is already running as an installed app", () => {    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("standalone"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    const { container } = render(<InstallAffordance pathname="/owner" />);
    fireEvent(window, new FakeInstallPromptEvent("beforeinstallprompt"));
    expect(container.textContent?.trim()).toBe("");
  });
});
