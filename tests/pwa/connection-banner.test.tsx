// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionBanner } from "@/components/pwa/connection-banner";

// The offline truth the app must show (docs/design-system/pwa.md):
//   * say plainly that the device is offline;
//   * say what still works and what does not — payments, staff and
//     settings need a connection and must never pretend to succeed;
//   * never block the page, and never nag twice in one visit.
//
// Agent-owned file (tests/pwa/**).

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

beforeEach(() => {
  setOnline(true);
});

afterEach(() => {
  cleanup();
});

describe("the connection banner", () => {
  it("stays out of the way while the device is online", () => {
    const { container } = render(<ConnectionBanner pathname="/owner" />);
    expect(container.textContent?.trim()).toBe("");
  });

  it("says the device is offline and what does not work", () => {
    setOnline(false);
    render(<ConnectionBanner pathname="/owner" />);
    expect(screen.getByText(/offline/i)).toBeTruthy();
    expect(screen.getByText(/needs a connection|need a connection/i)).toBeTruthy();
  });

  it("appears when the connection drops while the page is open", async () => {
    render(<ConnectionBanner pathname="/owner" />);
    expect(screen.queryByText(/offline/i)).toBeNull();
    setOnline(false);
    fireEvent(window, new Event("offline"));
    expect(await screen.findByText(/offline/i)).toBeTruthy();
  });

  it("never appears on the operator console", () => {
    setOnline(false);
    const { container } = render(<ConnectionBanner pathname="/ops" />);
    expect(container.textContent?.trim()).toBe("");
  });

  it("never appears on the attendance register, which has its own offline status", () => {
    // The register shows "You're offline", the pending count and the
    // sync failure itself. A second floating notice there would cover
    // the mark buttons at the bottom of the list.
    setOnline(false);
    const { container } = render(<ConnectionBanner pathname="/coach/register/session-1" />);
    expect(container.textContent?.trim()).toBe("");
  });

  it("can be dismissed for this visit without blocking the page", async () => {
    setOnline(false);
    render(
      <div>
        <h1>Owner home</h1>
        <ConnectionBanner pathname="/owner" />
      </div>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/offline/i)).toBeNull();
    expect(screen.getByRole("heading", { name: /owner home/i })).toBeTruthy();
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });
});
