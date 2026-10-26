// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallAffordance } from "@/components/pwa/install-affordance";
import {
  INSTALL_DISMISSAL_KEY,
  INSTALL_OFFER_DELAY_MS,
  INSTALL_OFFER_VISIBLE_MS,
  INSTALL_OFFER_SHOWN_KEY,
} from "@/lib/offline/install-prompt";

// The install UX contract (docs/design-system/pwa.md) plus the review
// finding from the coordinator's browser pass:
//
//   * contextual and dismissible — never a login-blocking modal;
//   * COMPACT: a single row, not a card with a paragraph and two
//     buttons. The measured offer used to be 138px tall and covered
//     three of nine visible member rows at 390x844;
//   * NON-BLOCKING: the offer never intercepts a click on the page
//     beneath it, and it never covers the bottom navigation;
//   * APPROPRIATELY TIMED: it arrives after a short delay, it leaves
//     again on its own, and it does not come back in the same session;
//   * Chromium's own install event is used when the browser offers one;
//   * iOS/iPadOS get accurate Add to Home Screen guidance instead of a
//     button that pretends to install;
//   * no repeated nagging: an explicit dismissal is remembered for a
//     month;
//   * never on the sign-in surface, the operator console, or a signed
//     parent link.
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

function fireInstallEvent() {
  fireEvent(window, new FakeInstallPromptEvent("beforeinstallprompt"));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the install affordance", () => {
  it("offers nothing before the browser can actually install", () => {
    const { container } = render(<InstallAffordance pathname="/owner" />);
    expect(container.textContent?.trim()).toBe("");
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("uses the browser's own install event when Chromium offers one", async () => {
    vi.useFakeTimers();
    render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();

    // The offer arrives after a short delay, not on the first frame.
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    const button = screen.getByRole("button", { name: /^install aqua$/i });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
    expect(screen.getByText(/installed/i)).toBeTruthy();
  });

  it("is one compact row, not a card with a paragraph", async () => {
    vi.useFakeTimers();
    const { container } = render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    const offer = container.querySelector('section[aria-label="Install Aqua"]');
    expect(offer).not.toBeNull();
    // A single row: one action and one dismissal, no paragraph of copy.
    expect(offer?.querySelectorAll("p")).toHaveLength(0);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("leaves the page again on its own instead of waiting to be dismissed", async () => {
    vi.useFakeTimers();
    render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(screen.getByRole("button", { name: /^install aqua$/i })).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_VISIBLE_MS + 10);
    });
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
  });

  it("does not come back in the same session", async () => {
    vi.useFakeTimers();
    const first = render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(screen.getByRole("button", { name: /^install aqua$/i })).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_VISIBLE_MS + 10);
    });
    first.unmount();

    // A later navigation fires the browser's event again (Chromium fires
    // it per page load). The offer must not ambush the person again.
    render(<InstallAffordance pathname="/owner/members" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
    expect(window.sessionStorage.getItem(INSTALL_OFFER_SHOWN_KEY)).toBeTruthy();
  });

  it("gives iOS accurate Add to Home Screen guidance instead of a fake install button", async () => {
    vi.useFakeTimers();
    setUserAgent(IPHONE_UA);
    render(<InstallAffordance pathname="/coach" />);
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    expect(screen.getByText(/add to home screen/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
  });

  it("does not nag again after the offer is dismissed", async () => {
    vi.useFakeTimers();
    const first = render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
    expect(window.localStorage.getItem(INSTALL_DISMISSAL_KEY)).toBeTruthy();
    first.unmount();

    render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
  });

  it("never appears on the sign-in surface", async () => {
    vi.useFakeTimers();
    for (const pathname of ["/login", "/login/reset", "/set-pin"]) {
      const { container } = render(<InstallAffordance pathname={pathname} />);
      fireInstallEvent();
      await act(async () => {
        vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
      });
      expect(container.textContent?.trim(), pathname).toBe("");
      cleanup();
    }
  });

  it("never appears on the parent surface or a signed parent link", async () => {
    vi.useFakeTimers();
    for (const pathname of ["/parent", "/p/9f2c-secret-token"]) {
      const { container } = render(<InstallAffordance pathname={pathname} />);
      fireInstallEvent();
      await act(async () => {
        vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
      });
      expect(container.textContent?.trim(), pathname).toBe("");
      cleanup();
    }
  });

  it("never appears on the operator console", async () => {
    vi.useFakeTimers();
    const { container } = render(<InstallAffordance pathname="/ops" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.textContent?.trim()).toBe("");
  });

  it("stays out of the way of the page: no modal, no focus theft", async () => {
    vi.useFakeTimers();
    render(
      <div>
        <h1>Owner home</h1>
        <InstallAffordance pathname="/owner" />
      </div>,
    );
    const before = document.activeElement;
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(screen.getByRole("button", { name: /^install aqua$/i })).toBeTruthy();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[aria-modal='true']")).toBeNull();
    expect(document.activeElement).toBe(before);
    expect(screen.getByRole("heading", { name: /owner home/i })).toBeTruthy();
  });

  it("waits for a connection before offering an install", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    fireEvent(window, new Event("online"));
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(screen.getByRole("button", { name: /^install aqua$/i })).toBeTruthy();
  });

  it("does not offer installation outside a secure context", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const { container } = render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.textContent?.trim()).toBe("");
  });

  it("stays quiet when the app is already running as an installed app", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
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
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.textContent?.trim()).toBe("");
  });
});
