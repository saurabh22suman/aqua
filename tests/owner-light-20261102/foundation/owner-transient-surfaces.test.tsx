// @vitest-environment jsdom
//
// PROVENANCE (foundation lane, 2 November 2026): this file is the
// INHERITED test of the reviewed transient-disclosure patch
// (outputs/owner-menu-dismissal-20261102/LOCAL-MENU-FIX.patch, originally
// tests/owner-menu-dismissal-20261102/owner-transient-surfaces.test.tsx).
// Its intended RED was observed BEFORE that implementation — the
// evidence is outputs/owner-menu-dismissal-20261102/red-run.log, and it
// belongs to that run; it is NOT re-created or claimed here. The file
// is carried into the lane's own test folder unchanged apart from this
// provenance note.
//
// Owner menu dismissal — 2 November 2026.
//
// The owner shell has three TRANSIENT surfaces: the account control in
// the phone header, the mobile record search and the mobile "More"
// menu. Each one is a native <details>, so it opens and closes with no
// JavaScript — but a bare disclosure does not dismiss itself. It stays
// open when the user presses outside it, when the focus leaves it, when
// the route changes and when another surface opens, so a menu keeps
// hanging over the page it belongs to.
//
// The shared behaviour these regressions pin down:
//   - a press outside (mouse, touch or pen) closes the surface, and
//     the dismissal never takes the focus away from what the user
//     pressed;
//   - the focus leaving the surface closes it;
//   - Escape closes it and gives the focus back to its OWN trigger;
//   - leaving the route closes it (a browser Back included);
//   - choosing a navigation action closes it;
//   - only one transient surface is open at a time;
//   - an ordinary, genuine disclosure (a report, a form, a help panel)
//     is left exactly as it was.
//
// These are agent-owned regressions (tests/owner-menu-dismissal-20261102),
// NOT the protected tests/tier1 suite. The three transient surfaces are
// the UI under test and are rendered for real; the children they host
// (the shared sign-out, the record search) are boundary probes here —
// their own source is unchanged and their own tests cover them.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/owner" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      children,
      onClick,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
      onClick?: (event: { preventDefault: () => void }) => void;
    }) =>
      React.createElement(
        "a",
        {
          href,
          ...rest,
          onClick: (event: { preventDefault: () => void }) => {
            event.preventDefault();
            onClick?.(event);
          },
        },
        children,
      ),
  };
});

// The shared sign-out, as a named boundary probe: its submit handler is
// the sign-out boundary a dismissal must never reach.
const signOutSubmit = vi.hoisted(() => vi.fn());
vi.mock("@/components/tenant-sign-out", async () => {
  const React = await import("react");
  return {
    TenantSignOut: ({ className }: { className?: string }) =>
      React.createElement(
        "form",
        {
          className,
          "data-testid": "tenant-sign-out-probe",
          onSubmit: (event: { preventDefault: () => void }) => {
            event.preventDefault();
            signOutSubmit();
          },
        },
        React.createElement("button", { type: "submit" }, "Sign out"),
      ),
  };
});

// The record search, as a named boundary probe: the field the transient
// surface has to keep usable while it is open.
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

import { OwnerAccountControl } from "@/components/owner-home/owner-account-control";
import { OwnerShell } from "@/components/owner-shell";
import { ownerNavForPermissions, ownerSidebarGroupsForPermissions } from "@/lib/nav";

const GRANTS = new Set(["members.read", "attendance.read", "reports.operational"]);

afterEach(() => {
  cleanup();
  navigation.pathname = "/owner";
  vi.clearAllMocks();
});

function renderShell() {
  return render(
    <OwnerShell
      navItems={ownerNavForPermissions(GRANTS)}
      sidebarGroups={ownerSidebarGroupsForPermissions(GRANTS)}
      locations={[]}
      clubName="Demo club"
    >
      <p>Work</p>
    </OwnerShell>,
  );
}

// The phone record search lives inside the More panel (Owner light, 2
// November 2026: the header row carries the club identity, the facility
// in scope and the account, and the search needs its own room). The
// dismissal contract is unchanged — it is still ONE transient surface:
// an outside press, the focus leaving, Escape (focus back to its own
// trigger) and a route change close it, and the search field inside it
// keeps its query.
function searchSurface() {
  return moreSurface();
}

function searchTrigger() {
  return within(screen.getByTestId("owner-mobile-nav"))
    .getByText("More")
    .closest("summary") as HTMLElement;
}

function accountSurface() {
  return within(screen.getByTestId("owner-header-account"))
    .getByText("Account")
    .closest("details") as HTMLDetailsElement;
}

function moreSurface() {
  return within(screen.getByTestId("owner-mobile-nav"))
    .getByText("More")
    .closest("details") as HTMLDetailsElement;
}

describe("owner account control (phone header)", () => {
  it("opens with the native disclosure and keeps the Appearance link and the shared sign-out", () => {
    render(
      <div>
        <OwnerAccountControl accountName="Divya Sharma" />
        <button type="button">Outside</button>
      </div>,
    );
    const trigger = screen.getByText("Account").closest("summary") as HTMLElement;
    const details = trigger.closest("details") as HTMLDetailsElement;

    expect(details.open).toBe(false);
    expect(trigger.textContent).toContain("Account");

    fireEvent.click(trigger);

    expect(details.open).toBe(true);
    expect(screen.getByRole("link", { name: "Appearance" }).getAttribute("href")).toBe(
      "/owner/settings/appearance",
    );
    expect(screen.getByTestId("tenant-sign-out-probe")).toBeTruthy();
  });

  it.each(["mouse", "touch", "pen"])("closes on an outside %s press", (pointerType) => {
    render(
      <div>
        <OwnerAccountControl />
        <button type="button">Outside</button>
      </div>,
    );
    const trigger = screen.getByText("Account").closest("summary") as HTMLElement;
    const details = trigger.closest("details") as HTMLDetailsElement;
    fireEvent.click(trigger);
    expect(details.open).toBe(true);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }), { pointerType });

    expect(details.open).toBe(false);
  });

  it("closes when the focus leaves it and leaves the focus where the user put it", () => {
    render(
      <div>
        <OwnerAccountControl />
        <button type="button">Outside</button>
      </div>,
    );
    const trigger = screen.getByText("Account").closest("summary") as HTMLElement;
    const details = trigger.closest("details") as HTMLDetailsElement;
    fireEvent.click(trigger);

    const inside = screen.getByRole("link", { name: "Appearance" });
    inside.focus();
    expect(details.open).toBe(true);

    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(outside);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("closes on Escape and gives the focus back to its own trigger", () => {
    render(<OwnerAccountControl />);
    const trigger = screen.getByText("Account").closest("summary") as HTMLElement;
    const details = trigger.closest("details") as HTMLDetailsElement;
    fireEvent.click(trigger);
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the route changes", () => {
    const { rerender } = render(<OwnerAccountControl />);
    const trigger = screen.getByText("Account").closest("summary") as HTMLElement;
    const details = trigger.closest("details") as HTMLDetailsElement;
    fireEvent.click(trigger);
    expect(details.open).toBe(true);

    navigation.pathname = "/owner/settings/appearance";
    rerender(<OwnerAccountControl />);

    expect(details.open).toBe(false);
  });

  it("closes when a navigation action is chosen, without reaching the sign-out boundary", () => {
    render(<OwnerAccountControl />);
    const trigger = screen.getByText("Account").closest("summary") as HTMLElement;
    const details = trigger.closest("details") as HTMLDetailsElement;
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("link", { name: "Appearance" }));

    expect(details.open).toBe(false);
    expect(signOutSubmit).not.toHaveBeenCalled();
  });

  it("keeps its children and never signs out when it is dismissed", () => {
    render(
      <div>
        <OwnerAccountControl />
        <button type="button">Outside</button>
      </div>,
    );
    const trigger = screen.getByText("Account").closest("summary") as HTMLElement;
    const details = trigger.closest("details") as HTMLDetailsElement;
    fireEvent.click(trigger);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));

    expect(details.open).toBe(false);
    // The children are still the caller's: the dismissal removed no
    // control and it did not submit the sign-out form.
    expect(screen.getByRole("link", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByTestId("tenant-sign-out-probe")).toBeTruthy();
    expect(signOutSubmit).not.toHaveBeenCalled();
  });
});

describe("owner mobile record search", () => {
  it("opens with the native disclosure and holds the record search field", () => {
    renderShell();
    const details = searchSurface();
    const trigger = searchTrigger();

    expect(details.open).toBe(false);

    fireEvent.click(trigger);

    expect(details.open).toBe(true);
    expect(within(details).getByTestId("global-search-input")).toBeTruthy();
  });

  it("stays open while the search field is used", () => {
    renderShell();
    const details = searchSurface();
    fireEvent.click(searchTrigger());

    const input = within(details).getByTestId("global-search-input") as HTMLInputElement;
    fireEvent.pointerDown(input);
    input.focus();
    fireEvent.change(input, { target: { value: "arjun" } });

    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("closes on an outside press", () => {
    renderShell();
    const details = searchSurface();
    fireEvent.click(searchTrigger());
    expect(details.open).toBe(true);

    fireEvent.pointerDown(document.body);

    expect(details.open).toBe(false);
  });

  it("closes on Escape and gives the focus back to its own trigger", () => {
    renderShell();
    const details = searchSurface();
    const trigger = searchTrigger();
    fireEvent.click(trigger);

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the route changes", () => {
    const { rerender } = renderShell();
    const details = searchSurface();
    fireEvent.click(searchTrigger());
    expect(details.open).toBe(true);

    navigation.pathname = "/owner/members";
    rerender(
      <OwnerShell
        navItems={ownerNavForPermissions(GRANTS)}
        sidebarGroups={ownerSidebarGroupsForPermissions(GRANTS)}
        locations={[]}
        clubName="Demo club"
      >
        <p>Work</p>
      </OwnerShell>,
    );

    expect(details.open).toBe(false);
  });
});

describe("owner mobile More menu", () => {
  it("closes on an outside press", () => {
    renderShell();
    const details = moreSurface();
    fireEvent.click(
      within(screen.getByTestId("owner-mobile-nav")).getByText("More").closest("summary") as HTMLElement,
    );
    expect(details.open).toBe(true);

    fireEvent.pointerDown(document.body);

    expect(details.open).toBe(false);
  });

  it("closes when the focus leaves it", () => {
    renderShell();
    const details = moreSurface();
    fireEvent.click(
      within(screen.getByTestId("owner-mobile-nav")).getByText("More").closest("summary") as HTMLElement,
    );

    const reports = within(screen.getByTestId("owner-mobile-nav")).getByRole("link", { name: "Reports" });
    reports.focus();
    expect(details.open).toBe(true);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    expect(details.open).toBe(false);
    outside.remove();
  });

  it("closes when a destination is chosen", () => {
    renderShell();
    const details = moreSurface();
    const trigger = within(screen.getByTestId("owner-mobile-nav"))
      .getByText("More")
      .closest("summary") as HTMLElement;
    fireEvent.click(trigger);

    fireEvent.click(
      within(screen.getByTestId("owner-mobile-nav")).getByRole("link", { name: "Reports" }),
    );

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the route changes", () => {
    const { rerender } = renderShell();
    const details = moreSurface();
    fireEvent.click(
      within(screen.getByTestId("owner-mobile-nav")).getByText("More").closest("summary") as HTMLElement,
    );
    expect(details.open).toBe(true);

    navigation.pathname = "/owner/reports";
    rerender(
      <OwnerShell
        navItems={ownerNavForPermissions(GRANTS)}
        sidebarGroups={ownerSidebarGroupsForPermissions(GRANTS)}
        locations={[]}
        clubName="Demo club"
      >
        <p>Work</p>
      </OwnerShell>,
    );

    expect(details.open).toBe(false);
  });
});

describe("one transient surface at a time", () => {
  it("closes the account control when the record search opens", () => {
    renderShell();
    const account = accountSurface();
    const search = searchSurface();

    fireEvent.click(
      within(screen.getByTestId("owner-header-account")).getByText("Account").closest("summary") as HTMLElement,
    );
    expect(account.open).toBe(true);

    fireEvent.click(searchTrigger());

    expect(account.open).toBe(false);
    expect(search.open).toBe(true);
  });

  it("closes the record search when the account control opens", () => {
    renderShell();
    const account = accountSurface();
    const search = searchSurface();

    fireEvent.click(searchTrigger());
    expect(search.open).toBe(true);

    fireEvent.click(
      within(screen.getByTestId("owner-header-account")).getByText("Account").closest("summary") as HTMLElement,
    );

    expect(search.open).toBe(false);
    expect(account.open).toBe(true);
  });
});

describe("ordinary disclosures", () => {
  it("leaves a plain native disclosure alone", () => {
    render(
      <details data-testid="plain">
        <summary>Plain</summary>
        <div>Body</div>
      </details>,
    );
    const details = screen.getByTestId("plain") as HTMLDetailsElement;
    const trigger = screen.getByText("Plain") as HTMLElement;
    fireEvent.click(trigger);
    expect(details.open).toBe(true);

    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(details.open).toBe(true);
  });
});
