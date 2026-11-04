// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026): the Owner Appearance
// settings offer no theme choice an owner can find.
//
// The human reported that the accent "seems inactive". The investigation
// separates two different things:
//
//   * the TENANT branding accent is functional and stays: it paints the
//     academy mark (`components/branding/tenant-mark.tsx`) and nothing
//     else. It is not deleted, not reset and not re-pointed at the theme.
//   * the actual THEME (display preset) was only reachable through the
//     shared icon-only toggle, whose label is hidden below the `sm`
//     breakpoint (`components/theme/theme-toggle.tsx` renders the preset
//     name in `<span className="hidden sm:inline">`). On a phone the owner
//     saw a palette glyph and had to guess what it did.
//
// The fix is an EXPLICIT, named choice on the appearance page: two native
// radio controls labelled "Mint Garden" and "Lavender Club", the current
// preset visibly selected, and the shared theme provider's `setTheme`
// called with the matching enum value. The shared ThemeToggle itself is
// Foundation-owned and is NOT modified; the artwork chooser and the
// personal/device semantics stay on the same page.
//
// This test renders the REAL appearance page (the route the owner opens),
// so the failures are the visible behaviour itself — not a missing module.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-a",
    userId: "user-a",
    permissions: new Set<string>(),
    features: new Set<string>(),
  }),
}));

// The shared theme provider is the ONLY way the preset may change. The
// test observes the call it makes, so the assertion is about the real
// contract and not about the component's internals.
vi.mock("@/components/theme/theme-provider", () => ({
  useTheme: () => ({ theme: "mint", setTheme }),
}));

import AppearancePage from "@/app/(owner)/owner/settings/appearance/page";

afterEach(() => {
  cleanup();
  setTheme.mockClear();
});

describe("Owner Appearance — the theme is an explicit, named choice", () => {
  it("offers the two named presets as radio choices", async () => {
    render(await AppearancePage());

    // INTENDED RED today: the page renders one icon-only toggle button
    // and no radio control at all.
    const mint = screen.getByRole("radio", { name: "Mint Garden" });
    const lavender = screen.getByRole("radio", { name: "Lavender Club" });

    // Scoped to the theme control: the artwork chooser on the same page
    // legitimately has its own radio group.
    const themeChoice = within(screen.getByTestId("owner-theme-choice"));
    expect(themeChoice.getAllByRole("radio")).toHaveLength(2);
    expect((mint as HTMLInputElement).checked).toBe(true);
    expect((lavender as HTMLInputElement).checked).toBe(false);
  });

  it("shows which preset is selected", async () => {
    render(await AppearancePage());

    const mint = screen.getByRole("radio", { name: "Mint Garden" });
    const lavender = screen.getByRole("radio", { name: "Lavender Club" });

    // A visible selected state, not only the browser's radio dot: the
    // selected option is marked as selected for the owner and for the
    // screen reader.
    expect(mint.closest("[data-selected]")?.getAttribute("data-selected")).toBe(
      "true",
    );
    expect(
      lavender.closest("[data-selected]")?.getAttribute("data-selected"),
    ).toBe("false");
  });

  it("applies the chosen preset through the shared theme provider", async () => {
    render(await AppearancePage());

    const lavender = screen.getByRole("radio", { name: "Lavender Club" });
    fireEvent.click(lavender);

    expect(setTheme).toHaveBeenCalledWith("lavender");
    expect(setTheme).not.toHaveBeenCalledWith("mint");
  });

  it("does not leave the icon-only theme toggle as the owner's only control", async () => {
    render(await AppearancePage());

    // The shared toggle announces "Theme: <preset>. Switch to <preset>".
    // INTENDED RED today: that button is the only theme control here.
    expect(screen.queryByRole("button", { name: /switch to/i })).toBeNull();
  });

  it("keeps the artwork chooser on the same page", async () => {
    render(await AppearancePage());

    // The artwork chooser is the page's other half and must survive.
    expect(
      screen.getByRole("group", { name: /collection card artwork/i }),
    ).toBeTruthy();
  });

  it("states the device scope once, in one place", async () => {
    render(await AppearancePage());

    const themeChoice = within(screen.getByTestId("owner-theme-choice"));

    // INTENDED RED today: the control explains the purpose in prose and
    // the page header repeats the same scope in its purpose line. The
    // human rejected that expository style — the scope belongs to ONE
    // owner, the control itself.
    expect(themeChoice.getByText("Saved on this device.")).toBeTruthy();
    expect(screen.getAllByText("Saved on this device.")).toHaveLength(1);

    // The expository sentences are gone: no records, no permissions, no
    // "what anyone else sees".
    expect(themeChoice.queryByText(/never your records/i)).toBeNull();
    expect(themeChoice.queryByText(/what anyone else sees/i)).toBeNull();

    // The page header no longer repeats the scope.
    expect(screen.queryByText("Theme & artwork for this device.")).toBeNull();
  });
});
