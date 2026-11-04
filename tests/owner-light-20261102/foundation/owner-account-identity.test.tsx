// @vitest-environment jsdom
//
// Owner account identity — the account controls draw the PERSON (3
// November 2026).
//
// The confirmed source defect: the owner layout passed the club's
// branding initials (branding.initials) into the owner shell, the shell
// passed them to the account control in the header, and the sidebar's
// account row drew them as well. Both are ACCOUNT controls: a club
// called "Splash SC" therefore gave its owner "SC" — the club's letters
// worn as a person's identity. The approved owner mock shows the owner's
// OWN initials.
//
// The correction reuses the existing, tenant-scoped identity read
// (lib/services/staff.ts — getCurrentStaffIdentity, which resolves the
// signed-in user's own full name through withTenant) and the shared
// PersonAvatar (name graphemes + theme geometry). No new identity
// service, no new grant, no raw users query, no change to the auth,
// permission or query scope.
//
// The identity read happens AFTER the layout's own context resolution
// and surface gate, and it is handed the resolved ctx — a rejected role
// reads no identity at all.
//
// This file is agent-owned (tests/owner-light-20261102/foundation). It
// does not touch tests/tier1/**.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: true,
  ctx: vi.fn(),
  identity: vi.fn(),
  branding: vi.fn(),
  locations: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

// The layout's own boundary: the resolved context, the surface gate and
// the two existing reads.
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: state.ctx }));
vi.mock("@/lib/auth/surface-access", () => ({
  SURFACE_OWNER: "owner",
  canAccessSurface: () => state.allowed,
}));
vi.mock("@/lib/services/people", () => ({ listLocations: state.locations }));
vi.mock("@/lib/services/branding", () => ({ getBranding: state.branding }));
// The ONE sanctioned identity read. It is mocked whole: the layout must
// use this service, not a raw users query of its own.
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: state.identity }));

// The shared sign-out and the record search are boundary probes: their
// own source is unchanged here and their own tests cover them.
vi.mock("@/components/tenant-sign-out", async () => {
  const React = await import("react");
  return {
    TenantSignOut: ({ className }: { className?: string }) =>
      React.createElement(
        "form",
        { className, "data-testid": "tenant-sign-out-probe" },
        React.createElement("button", { type: "submit" }, "Sign out"),
      ),
  };
});

vi.mock("@/components/global-search", async () => {
  const React = await import("react");
  return {
    GlobalSearch: () =>
      React.createElement("input", {
        type: "text",
        "data-testid": "global-search-input",
        "aria-label": "Search club",
      }),
  };
});

import OwnerLayout from "@/app/(owner)/layout";
import { OwnerAccountControl } from "@/components/owner-home/owner-account-control";

const OWNER_CTX = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  membershipId: "33333333-3333-4333-8333-333333333333",
  roleKey: "owner",
  roleId: "44444444-4444-4444-8444-444444444444",
  slug: "",
  allLocations: true,
  locationIds: [],
  permissions: new Set([
    "members.read",
    "attendance.read",
    "reports.operational",
    "settings.manage",
  ]),
  features: new Set<string>(),
};

const PHONE = "+919000000001";

beforeEach(() => {
  state.allowed = true;
  state.ctx.mockReset().mockResolvedValue(OWNER_CTX);
  state.identity
    .mockReset()
    .mockResolvedValue({ fullName: "Aditi Mehra", phone: PHONE });
  state.branding.mockReset().mockResolvedValue({
    displayName: "Splash Sports Club",
    shortName: "SSC",
    accent: "mango",
    fallbackDisplayName: "Splash Sports Club",
    fallbackShortName: "SSC",
    // The club's BRANDING initials.
    initials: "SC",
  });
  state.locations.mockReset().mockResolvedValue([]);
});

afterEach(cleanup);

async function renderLayout() {
  const layout = await OwnerLayout({ children: <p>Owner page</p> });
  return render(layout);
}

function accountControl(): HTMLElement {
  return screen.getByTestId("owner-header-account");
}

function sidebarAccountRow(): HTMLElement {
  return screen.getByTestId("owner-shell-account");
}

describe("the account controls draw the person, not the club", () => {
  it("draws the owner's own initials in the header account control", async () => {
    await renderLayout();

    const control = accountControl();

    // RED: the control draws the club's branding initials ("SC"), so the
    // owner of "Splash Sports Club" wears the club's letters as their own
    // identity. The approved mock shows the owner's initials.
    expect(control.textContent).toContain("AM");
    expect(control.textContent).not.toContain("SC");
    // The shared primitive owns the initials and the geometry.
    expect(within(control).getByTestId("person-avatar").textContent).toBe("AM");
  });

  it("draws the owner's own initials in the sidebar account row", async () => {
    await renderLayout();

    const row = sidebarAccountRow();

    // RED: the sidebar's account row draws the club's initials too.
    expect(row.textContent).toContain("AM");
    expect(row.textContent).not.toContain("SC");
    expect(within(row).getByTestId("person-avatar").textContent).toBe("AM");
  });

  it("reads the identity once, through the sanctioned service, with the resolved ctx", async () => {
    await renderLayout();

    expect(state.identity).toHaveBeenCalledTimes(1);
    expect(state.identity).toHaveBeenCalledWith(OWNER_CTX);
  });

  it("keeps an Indian-script name whole", async () => {
    state.identity.mockResolvedValue({ fullName: "मीरा सिंह", phone: PHONE });
    await renderLayout();

    // The conjunct and the vowel sign stay with their base letter.
    expect(within(accountControl()).getByTestId("person-avatar").textContent).toBe(
      "मीसिं",
    );
  });

  it("keeps a combining accent whole", async () => {
    state.identity.mockResolvedValue({
      fullName: "e\u0301mile Zola",
      phone: PHONE,
    });
    await renderLayout();

    // "e" + U+0301 is ONE grapheme: it is never split into a bare "E".
    // The combining acute stays with its base letter, so the drawn
    // initials are the decomposed "E" + U+0301, then "Z".
    expect(within(accountControl()).getByTestId("person-avatar").textContent).toBe(
      "E\u0301Z",
    );
  });

  it("shows an honest unknown when the owner has no staff record", async () => {
    state.identity.mockResolvedValue({ fullName: null, phone: PHONE });
    await renderLayout();

    const control = accountControl();

    // An owner who was never entered as a person has no name. The mark
    // says "?" — an honest unknown, never the club's letters.
    expect(within(control).getByTestId("person-avatar").textContent).toBe("?");
    expect(control.textContent).not.toContain("SC");
  });

  it("shows an honest unknown when there is no identity at all", async () => {
    state.identity.mockResolvedValue(null);
    await renderLayout();

    const control = accountControl();

    expect(within(control).getByTestId("person-avatar").textContent).toBe("?");
    expect(control.textContent).not.toContain("SC");
  });

  it("reads no identity for a rejected role", async () => {
    state.allowed = false;

    await expect(
      OwnerLayout({ children: <p>Owner page</p> }),
    ).rejects.toThrow("not found");

    // The identity read happens AFTER the layout's own context resolution
    // and surface gate: a caller that never reached the owner surface
    // reads no identity.
    expect(state.identity).not.toHaveBeenCalled();
  });
});

describe("the account control keeps its own behaviour", () => {
  it("keeps the dismissal, the Appearance link and the sign-out", async () => {
    await renderLayout();

    const control = accountControl();
    const trigger = within(control).getByText("Account").closest("summary") as HTMLElement;
    const details = trigger.closest("details") as HTMLDetailsElement;

    expect(details.open).toBe(false);
    fireEvent.click(trigger);
    expect(details.open).toBe(true);
    expect(
      screen.getByRole("link", { name: "Appearance" }).getAttribute("href"),
    ).toBe("/owner/settings/appearance");
    expect(screen.getAllByTestId("tenant-sign-out-probe").length).toBeGreaterThan(0);

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("draws the person's initials when it is used on its own", () => {
    render(<OwnerAccountControl accountName="Aditi Mehra" />);

    expect(screen.getByTestId("person-avatar").textContent).toBe("AM");
    expect(screen.getByText("Account")).toBeTruthy();
  });
});
