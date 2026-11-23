// @vitest-environment jsdom
//
// Owner Courtside — the approved Owner phone tab order.
//
// The human-approved Owner mobile order is exactly:
//
//   Today · Enquiries · Schedule · Members · More
//
// Fees and Updates stay in More, with their real destinations and the
// existing permission/feature filtering. Every other owner-surface role
// (Manager, Accountant, Admin) keeps the current safe preset:
//
//   Home · Members · Fees · More
//
// What this pins:
//
//   * the four primary tabs render in the named order, from the SAME
//     permission-filtered navigation source the desktop sidebar uses;
//   * Fees and Updates are reachable from More with scoped URLs;
//   * More is the current section on the Fees and Updates routes;
//   * the legacy preset (and a permission-limited caller) never gets a
//     destination injected that its grants do not allow.
//
// RED status at the time of writing: the phone bar still rendered
// Home / Members / Fees and had no preset prop, so the order assertion
// fails and Fees is still a primary tab.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ pathname: "/owner", query: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.query),
}));

vi.mock("@/components/owner-ui/owner-link", () => ({
  OwnerLink: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/tenant-sign-out", () => ({
  TenantSignOut: () => <button type="button">Sign out</button>,
}));

import { OwnerMobileNav, type OwnerMobileNavPreset } from "@/components/owner-ui/owner-mobile-nav";
import { ownerNavForPermissions, ownerSidebarGroupsForPermissions } from "@/lib/nav";

afterEach(cleanup);

// The grants a true Owner holds for the destinations under test. The
// component must never invent a destination; this set is only the
// input to the EXISTING permission filter.
const OWNER_GRANTS = [
  "members.read",
  "invoices.read",
  "enquiries.read",
  "messaging.send",
  "programs.read",
  "programs.write",
  "attendance.read",
  "staff.read",
  "reports.operational",
  "settings.manage",
] as const;

// The manager's operational grants: no messaging.send (so the inbox
// appears), no settings.manage, no programs.write.
const MANAGER_GRANTS = [
  "members.read",
  "invoices.read",
  "enquiries.read",
  "programs.read",
  "attendance.read",
  "staff.read",
  "reports.operational",
  "dashboard.view",
  "payments.record",
] as const;

function renderNav({
  permissions = new Set<string>(OWNER_GRANTS),
  preset = "courtside",
  pathname = "/owner",
  query = "facility=all",
}: {
  permissions?: ReadonlySet<string>;
  preset?: OwnerMobileNavPreset;
  pathname?: string;
  query?: string;
} = {}) {
  state.pathname = pathname;
  state.query = query;
  return render(
    <OwnerMobileNav
      preset={preset}
      navItems={ownerNavForPermissions(permissions)}
      sidebarGroups={ownerSidebarGroupsForPermissions(permissions)}
    />,
  );
}

function primaryTabs(): HTMLAnchorElement[] {
  const nav = screen.getByRole("navigation", { name: "Primary" });
  return Array.from(nav.children).filter(
    (element): element is HTMLAnchorElement => element.tagName === "A",
  );
}

function primaryLabels(): string[] {
  return primaryTabs().map((tab) => tab.textContent?.trim() ?? "");
}

function openMore() {
  fireEvent.click(screen.getByText("More", { exact: true }));
  return screen.getByRole("navigation", { name: "Primary" });
}

describe("Owner Courtside phone tabs", () => {
  it("renders Today · Enquiries · Schedule · Members, with Fees and Announcements in More", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Primary" });

    expect(primaryLabels()).toEqual(["Today", "Enquiries", "Schedule", "Members"]);
    expect(primaryTabs().map((tab) => tab.getAttribute("href"))).toEqual([
      "/owner?facility=all",
      "/owner/enquiries",
      "/owner/schedule?facility=all",
      "/owner/members?facility=all",
    ]);
    expect(primaryTabs()[0]?.getAttribute("aria-current")).toBe("page");
    expect(
      primaryTabs()
        .slice(1)
        .every((tab) => tab.getAttribute("aria-current") === null),
    ).toBe(true);

    // Four equal tab slots plus the More disclosure: a five-slot bar.
    expect(nav.getAttribute("style")).toContain("repeat(5, minmax(0, 1fr))");
    expect(Array.from(nav.children)).toHaveLength(5);
    expect(within(nav).getByText("More")).toBeTruthy();

    openMore();
    expect(within(nav).getByRole("link", { name: "Fees" }).getAttribute("href")).toBe(
      "/owner/fees?facility=all",
    );
    expect(within(nav).getByRole("link", { name: "Announcements" }).getAttribute("href")).toBe(
      "/owner/announcements",
    );
    expect(within(nav).getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it.each(["/owner/fees", "/owner/announcements"])(
    "marks More as the current section on %s",
    (pathname) => {
      renderNav({ pathname });
      const nav = screen.getByRole("navigation", { name: "Primary" });
      const trigger = within(nav).getByRole("button", { name: "More, current section" });

      expect(trigger?.textContent).toContain("Current section");
      expect(
        primaryTabs().every((tab) => tab.getAttribute("aria-current") === null),
      ).toBe(true);
    },
  );

  it("does not inject a tab whose destination the permission filter removes", () => {
    renderNav({ permissions: new Set(["members.read", "invoices.read"]) });

    expect(primaryLabels()).toEqual(["Today", "Members"]);
    expect(within(openMore()).getByRole("link", { name: "Fees" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Enquiries" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Schedule" })).toBeNull();
  });
});

describe("other owner-surface roles keep the current safe preset", () => {
  it("puts the scoped schedule on the manager's primary bar", () => {
    renderNav({ permissions: new Set<string>(MANAGER_GRANTS), preset: "operations", pathname: "/owner/schedule" });
    expect(primaryLabels()).toEqual(["Today", "Schedule", "Members"]);
    expect(screen.getByRole("link", { name: "Schedule" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Schedule" }).getAttribute("href")).toBe("/owner/schedule?facility=all");
    openMore();
    expect(screen.getByRole("link", { name: "Fees" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("renders Home · Members · Fees for a manager, with everything else in More", () => {
    renderNav({ permissions: new Set<string>(MANAGER_GRANTS), preset: "legacy" });

    expect(primaryLabels()).toEqual(["Home", "Members", "Fees"]);
    expect(primaryTabs().map((tab) => tab.getAttribute("href"))).toEqual([
      "/owner?facility=all",
      "/owner/members?facility=all",
      "/owner/fees?facility=all",
    ]);

    const nav = openMore();
    expect(within(nav).getByRole("link", { name: "Enquiries" }).getAttribute("href")).toBe(
      "/owner/enquiries",
    );
    expect(
      within(nav).getByRole("link", { name: "Announcements" }).getAttribute("href"),
    ).toBe("/owner/inbox");
  });

  it("keeps More current on the inbox route for the legacy preset", () => {
    renderNav({
      permissions: new Set<string>(MANAGER_GRANTS),
      preset: "legacy",
      pathname: "/owner/inbox",
    });

    const trigger = screen.getByText("More", { exact: true }).closest("summary");
    expect(trigger?.textContent).toContain("Current section");
    expect(
      primaryTabs().every((tab) => tab.getAttribute("aria-current") === null),
    ).toBe(true);
  });
});

it("keeps the shared Announcements entry active on the inbox for a sender", () => {
  renderNav({ permissions: new Set(["messaging.send"]), pathname: "/owner/inbox" });
  const entry = within(openMore()).getByRole("link", { name: "Announcements" });
  expect(entry.getAttribute("href")).toBe("/owner/announcements");
  expect(entry.getAttribute("aria-current")).toBe("page");
});
