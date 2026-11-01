import type { NavItem } from "@/components/bottom-nav";
import { OWNER_SIDEBAR_GROUPS, type OwnerSidebarGroup } from "@/lib/nav";

// Owner redesign · System lane — the owner navigation additions.
//
// The booking desk (docs/design/owner-redesign-20261027/task.md:
// "Booking navigation is currently missing: inspect the prior READ-ONLY
// worktree owner-booking-nav-20261027 and incorporate reviewed
// navigation changes in your own files") is a first-class owner
// destination under Scheduling, next to Programs & batches, Sessions and
// Schedule.
//
// Two independent gates decide whether the entry is offered, and they are
// the same two the BOOKINGS ROUTE itself enforces
// (app/(owner)/owner/bookings/page.tsx):
//
//   * the `bookings.read` permission, and
//   * the `pool.booking` feature entitlement.
//
// A hidden link is not a security control — the route and its actions stay
// authoritative — but a link that leads to a 404 for a tenant without the
// entitlement is a broken promise, so both gates are checked here.
//
// The mobile bottom nav is NOT touched: the four-item design contract
// (DESIGN.md §2) still holds, and the phone reaches the booking desk
// through Settings (the Operations lane owns those links).
//
// RED status at the time of writing: this helper returned the sidebar
// groups unchanged, so the booking desk had no navigation entry.

/** The booking desk's own gates, in one place. */
export const BOOKINGS_NAV_ITEM: NavItem = {
  href: "/owner/bookings",
  label: "Bookings",
  iconName: "calendar-days",
};

/** The group the booking desk belongs to. */
const SCHEDULING_GROUP = "Scheduling";

/**
 * Add the booking desk to the owner's Scheduling group when the caller
 * may read bookings and the tenant is entitled to the booking feature.
 *
 * The input groups are never mutated: the layout owns them and other
 * lanes read the same contract.
 */
export function ownerSidebarGroupsWithBookings(
  groups: OwnerSidebarGroup[],
  permissions: ReadonlySet<string>,
  features: ReadonlySet<string>,
): OwnerSidebarGroup[] {
  if (!permissions.has("bookings.read")) return [...groups];
  if (!features.has("pool.booking")) return [...groups];
  if (
    groups.some((group) =>
      group.items.some((item) => item.href === BOOKINGS_NAV_ITEM.href),
    )
  ) {
    return [...groups];
  }
  const existing = groups.find((group) => group.label === SCHEDULING_GROUP);
  if (existing) {
    return groups.map((group) =>
      group.label === SCHEDULING_GROUP
        ? { ...group, items: [...group.items, BOOKINGS_NAV_ITEM] }
        : { ...group, items: [...group.items] },
    );
  }
  // The permission filter can remove the WHOLE Scheduling group — a
  // limited role can hold bookings.read without programs.read,
  // programs.write or attendance.read. The booking desk is still
  // reachable then, so the group is created with it, in the canonical
  // order of the groups that are present.
  const created: OwnerSidebarGroup = {
    label: SCHEDULING_GROUP,
    items: [BOOKINGS_NAV_ITEM],
  };
  const canonicalIndex = OWNER_SIDEBAR_GROUPS.findIndex(
    (group) => group.label === SCHEDULING_GROUP,
  );
  const insertAt = groups.findIndex((group) => {
    const index = OWNER_SIDEBAR_GROUPS.findIndex(
      (candidate) => candidate.label === group.label,
    );
    return index > canonicalIndex;
  });
  if (insertAt === -1) return [...groups, created];
  return [...groups.slice(0, insertAt), created, ...groups.slice(insertAt)];
}
