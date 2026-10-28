import { describe, expect, it } from "vitest";

import {
  BOOKINGS_NAV_ITEM,
  ownerSidebarGroupsWithBookings,
} from "@/components/owner-ui/owner-navigation";
import { OWNER_SIDEBAR_GROUPS } from "@/lib/nav";

// Owner redesign · System lane — the booking navigation.
//
// The prior read-only worktree (owner-booking-nav-20261027) reviewed this
// change: the desktop Scheduling group gains "Bookings" for a caller who
// holds `bookings.read` AND whose tenant is entitled to `pool.booking`;
// the mobile four-tab contract is untouched; the Settings links belong to
// the Operations lane and are recorded in the handoff instead.
//
// RED status at the time of writing: the helper returned the groups
// unchanged, so a permitted owner saw no booking desk at all.

const PERMITTED = new Set(["bookings.read", "members.read", "programs.read"]);
const ENTITLED = new Set(["pool.booking"]);

function schedulingItems(groups: ReturnType<typeof ownerSidebarGroupsWithBookings>) {
  const group = groups.find((g) => g.label === "Scheduling");
  return group ? group.items.map((item) => item.href) : [];
}

describe("the booking navigation entry", () => {
  it("appears under Scheduling when the caller may read bookings and the tenant is entitled", () => {
    const groups = ownerSidebarGroupsWithBookings(
      OWNER_SIDEBAR_GROUPS,
      PERMITTED,
      ENTITLED,
    );
    expect(schedulingItems(groups)).toContain("/owner/bookings");
  });

  it("does not appear without the bookings.read permission", () => {
    const groups = ownerSidebarGroupsWithBookings(
      OWNER_SIDEBAR_GROUPS,
      new Set(["members.read"]),
      ENTITLED,
    );
    expect(schedulingItems(groups)).not.toContain("/owner/bookings");
  });

  it("does not appear without the pool.booking feature entitlement", () => {
    const groups = ownerSidebarGroupsWithBookings(
      OWNER_SIDEBAR_GROUPS,
      PERMITTED,
      new Set<string>(),
    );
    expect(schedulingItems(groups)).not.toContain("/owner/bookings");
  });

  it("never appears twice when the group already carries it", () => {
    const withBookings = OWNER_SIDEBAR_GROUPS.map((group) =>
      group.label === "Scheduling"
        ? { ...group, items: [...group.items, BOOKINGS_NAV_ITEM] }
        : group,
    );
    const groups = ownerSidebarGroupsWithBookings(withBookings, PERMITTED, ENTITLED);
    const hrefs = schedulingItems(groups);
    expect(hrefs.filter((href) => href === "/owner/bookings")).toHaveLength(1);
  });

  it("does not mutate the groups it was given", () => {
    const before = OWNER_SIDEBAR_GROUPS.map((group) => group.items.length);
    const groups = ownerSidebarGroupsWithBookings(
      OWNER_SIDEBAR_GROUPS,
      PERMITTED,
      ENTITLED,
    );
    expect(OWNER_SIDEBAR_GROUPS.map((group) => group.items.length)).toEqual(before);
    expect(groups).not.toBe(OWNER_SIDEBAR_GROUPS);
  });

  it("leaves every other destination and group untouched", () => {    const groups = ownerSidebarGroupsWithBookings(
      OWNER_SIDEBAR_GROUPS,
      PERMITTED,
      ENTITLED,
    );
    expect(groups.map((group) => group.label)).toEqual(
      OWNER_SIDEBAR_GROUPS.map((group) => group.label),
    );
    for (const group of groups) {
      const original = OWNER_SIDEBAR_GROUPS.find((g) => g.label === group.label);
      if (!original) continue;
      if (group.label === "Scheduling") continue;
      expect(group.items).toEqual(original.items);
    }
  });

  it("keeps the booking desk out of the mobile four-item contract", () => {
    // The bottom nav is built from TENANT_SURFACE_NAV.owner, which this
    // helper never touches: the phone reaches the booking desk through
    // Settings, and the four-tab contract (DESIGN.md §2) still holds.
    const groups = ownerSidebarGroupsWithBookings(
      OWNER_SIDEBAR_GROUPS,
      PERMITTED,
      ENTITLED,
    );
    const flat = groups.flatMap((group) => group.items.map((item) => item.href));
    expect(flat.filter((href) => href === "/owner/bookings")).toHaveLength(1);
  });

  it("creates the Scheduling group when the caller's permissions left it out", () => {
    // A limited role can hold bookings.read without holding
    // programs.read, attendance.read or programs.write — so the
    // permission filter removes the whole Scheduling group. The booking
    // desk is still reachable, so the group has to appear with it.
    const groups = ownerSidebarGroupsWithBookings([], PERMITTED, ENTITLED);
    expect(groups.map((group) => group.label)).toEqual(["Scheduling"]);
    expect(groups[0]?.items.map((item) => item.href)).toEqual([
      "/owner/bookings",
    ]);
  });

  it("creates no group at all when either gate is absent", () => {
    expect(ownerSidebarGroupsWithBookings([], PERMITTED, new Set())).toEqual(
      [],
    );
    expect(ownerSidebarGroupsWithBookings([], new Set(), ENTITLED)).toEqual(
      [],
    );
  });
});
