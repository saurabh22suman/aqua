// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the approved SECOND primary bar: Home · Members · Fees · More.
//
// Human approval (3 November 2026): the phone bar's third destination is
// FEES, not Calendar. Calendar stays reachable from Home's open-calendar
// action and from the More panel, and every permitted destination stays
// reachable. This pass changes the primary bar ONLY: the More panel's
// current transient list and the mounted search are unchanged, and no
// grouped sheet is invented.
//
// The destinations are still the already-filtered `available` source the
// desktop sidebar uses: a role without the Fees permission never gets a
// Fees tab (no injected destination), and optional modules (Bookings,
// Café) never shuffle the primary three.
//
// RED PROVENANCE: written before the product edit. Today the third
// primary is Calendar and Fees lives in More, so the first assertion
// fails on the rendered bar; the hrefs are real, not framework mocks.

const navigation = vi.hoisted(() => ({ pathname: "/owner/members" }));

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

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { OwnerMobileNav } from "@/components/owner-ui/owner-mobile-nav";
import { OWNER_SIDEBAR_GROUPS, TENANT_SURFACE_NAV, type OwnerSidebarGroup } from "@/lib/nav";

afterEach(() => {
  cleanup();
  navigation.pathname = "/owner/members";
});

function renderNav(groups: OwnerSidebarGroup[] = OWNER_SIDEBAR_GROUPS) {
  return render(
    <OwnerMobileNav
      navItems={TENANT_SURFACE_NAV.owner}
      sidebarGroups={groups}
      search={<input data-testid="phone-search" aria-label="Search records" />}
    />,
  );
}

function nav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

/** The three primary destinations plus the More disclosure column. */
function primaryLinks(): HTMLElement[] {
  return Array.from(nav().querySelectorAll(":scope > a"));
}

function moreDetails(): HTMLDetailsElement {
  const trigger = within(nav()).getByText("More").closest("summary");
  return trigger?.closest("details") as HTMLDetailsElement;
}

describe("the approved phone primary bar", () => {
  it("is Home, Members, Fees — not Calendar", () => {
    renderNav();
    const links = primaryLinks();

    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Home",
      "Members",
      "Fees",
    ]);
    // RED: the third primary is Calendar today.
    expect(links[2]?.getAttribute("href")).toBe("/owner/fees");
  });

  it("draws Fees with the approved money glyph and a short label", () => {
    renderNav();
    const fees = primaryLinks()[2]!;
    const svg = fees.querySelector("svg");

    // The existing mapper sends /owner/fees to the money geometry.
    expect(svg?.querySelector("rect")?.getAttribute("x")).toBe("3.5");
    expect(svg?.querySelector("rect")?.getAttribute("width")).toBe("17");
    // The short, consistent label sits beside the glyph.
    expect(fees.textContent?.trim()).toBe("Fees");
  });

  it("keeps Calendar in More, with a clear Calendar label and its route", () => {
    renderNav();
    const more = moreDetails();
    const calendar = within(more)
      .getAllByRole("link")
      .find((link) => link.getAttribute("href") === "/owner/schedule");

    // RED: More lists it as "Schedule" today.
    expect(calendar, "More keeps the Calendar destination").toBeTruthy();
    expect(calendar?.textContent?.trim()).toBe("Calendar");
  });

  it("keeps every permitted destination reachable and the search mounted", () => {
    renderNav();
    const more = moreDetails();
    for (const href of [
      "/owner/schedule",
      "/owner/fees?",
      "/owner/enquiries",
      "/owner/announcements",
      "/owner/staff",
      "/owner/programs",
      "/owner/sessions",
      "/owner/reports",
      "/owner/settings",
    ]) {
      if (href.endsWith("?")) continue;
      const found = [nav(), more].some((surface) =>
        Array.from(surface.querySelectorAll("a")).some(
          (link) => link.getAttribute("href") === href,
        ),
      );
      expect(found, `${href} must stay reachable`).toBe(true);
    }
    expect(within(more).getByTestId("phone-search")).toBeTruthy();
  });

  it("marks the active Fees destination, and More when a More route is open", () => {
    navigation.pathname = "/owner/fees";
    const first = renderNav();
    const fees = primaryLinks()[2]!;
    expect(fees.getAttribute("aria-current")).toBe("page");
    expect(
      within(nav()).getByText("More").closest("summary")?.className ?? "",
    ).not.toContain("underline");
    first.unmount();

    navigation.pathname = "/owner/schedule";
    renderNav();
    for (const link of primaryLinks()) {
      expect(link.getAttribute("aria-current")).toBeNull();
    }
    const moreTrigger = within(nav()).getByText("More").closest("summary");
    expect(moreTrigger?.className ?? "").toContain("underline");
    expect(within(moreDetails()).getByText("Current section")).toBeTruthy();
  });

  it("never injects a Fees tab for a role without it", () => {
    // The filtered source without the Fees group item: the bar falls back
    // to the permitted destinations and Calendar still sits in More.
    const withoutFees = OWNER_SIDEBAR_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.href !== "/owner/fees"),
    }));
    renderNav(withoutFees);
    const labels = primaryLinks().map((link) => link.textContent?.trim());
    expect(labels).toEqual(["Home", "Members"]);
    expect(
      within(moreDetails())
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/owner/fees"),
    ).toBe(false);
  });

  it("does not let optional modules shuffle the primary three", () => {
    const withOptional: OwnerSidebarGroup[] = OWNER_SIDEBAR_GROUPS.map((group) =>
      group.label === "Scheduling"
        ? {
            ...group,
            items: [
              ...group.items,
              { href: "/owner/bookings", label: "Bookings", iconName: "calendar-days" },
              { href: "/owner/cafe", label: "Café", iconName: "receipt" },
            ],
          }
        : group,
    );
    renderNav(withOptional);
    expect(primaryLinks().map((link) => link.textContent?.trim())).toEqual([
      "Home",
      "Members",
      "Fees",
    ]);
    const moreLinks = within(moreDetails()).getAllByRole("link");
    expect(moreLinks.some((link) => link.getAttribute("href") === "/owner/bookings")).toBe(true);
    expect(moreLinks.some((link) => link.getAttribute("href") === "/owner/cafe")).toBe(true);
  });

  it("keeps the More transient behaviour (outside press closes it)", () => {
    renderNav();
    const details = moreDetails();
    fireEvent.click(within(nav()).getByText("More"));
    expect(details.open).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(details.open).toBe(false);
  });
});
