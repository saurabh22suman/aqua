// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the appearance control in Ops.
//
// The console had NO way to choose Mint Garden or Lavender Club: the
// theme toggle lives in the owner surfaces only, so an operator — and
// the independent reviewer walking every console page — could not see
// the console in the second approved preset without a hidden cookie
// or DOM mutation.
//
// The fix REUSES the existing shared control
// (components/theme/theme-toggle.tsx). That component, the provider and
// the tokens are NOT changed; Ops simply renders the control in its
// ACCOUNT area, next to the role and the exit, and in the phone
// header so it stays reachable on a small screen.
//
// The appearance control is a DISPLAY preference. It carries no
// permission, no data scope and no identity: switching it must not
// change who is signed in or what they may do.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  value: { kind: "authenticated", role: "admin" } as { kind: string; role?: string },
}));

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => authState.value,
}));

const pathname = vi.hoisted(() => ({ value: "/ops" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

import PlatformLayout from "@/app/(platform)/layout";

beforeEach(() => {
  document.documentElement.dataset.theme = "mint";
});

afterEach(() => {
  cleanup();
  authState.value = { kind: "authenticated", role: "admin" };
  pathname.value = "/ops";
});

describe("Ops — the appearance control", () => {
  it("offers the appearance control in the account area of the rail", async () => {
    render(await PlatformLayout({ children: <p>page body</p> }));

    const account = screen.getByTestId("ops-shell-account");
    const toggle = within(account).getByTestId("theme-toggle");
    expect(toggle).toBeDefined();
  });

  it("offers the appearance control in the phone header too", async () => {
    render(await PlatformLayout({ children: <p>page body</p> }));

    const header = screen.getByTestId("platform-mobile-header");
    expect(within(header).getByTestId("theme-toggle")).toBeDefined();
  });

  it("switches the document's theme when it is used", async () => {
    render(await PlatformLayout({ children: <p>page body</p> }));

    const toggle = screen.getAllByTestId("theme-toggle")[0];
    fireEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe("lavender");
  });

  it("leaves the signed-in identity and its permissions untouched", async () => {
    render(await PlatformLayout({ children: <p>page body</p> }));

    const toggle = screen.getAllByTestId("theme-toggle")[0];
    fireEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe("lavender");
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(
        "Read-only: this account can browse, not change, platform data.",
      ),
    ).toBeNull();
  });

  it("keeps the navigation and the exit control reachable beside it", async () => {
    render(await PlatformLayout({ children: <p>page body</p> }));

    const account = screen.getByTestId("ops-shell-account");
    expect(within(account).getByRole("button", { name: "Sign out" })).toBeDefined();
    const nav = screen.getByRole("navigation", { name: "Platform" });
    expect(within(nav).getAllByRole("link").length).toBe(7);
  });
});
