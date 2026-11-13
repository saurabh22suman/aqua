import type { NavItem } from "@/components/bottom-nav";
import { OWNER_SIDEBAR_GROUPS, type OwnerSidebarGroup } from "@/lib/nav";
import type { OwnerIconName } from "@/components/owner-ui/owner-icon";
import { hasBookingEntitlement } from "@/lib/auth/booking-entitlement";

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
  if (!hasBookingEntitlement(features)) return [...groups];
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

// ── The Owner icon names ────────────────────────────────────────────
//
// The human rejected the icon pack in the baseline screenshot
// (ICON-ADDENDUM.md, 2 November 2026): the Owner surfaces must draw the
// approved MOCK's own outline geometry, not a different Lucide symbol
// and not an invented filled or duotone one.
//
// The mapping is EXPLICIT and per destination, because the shared
// navigation registry names two different destinations with the same
// Lucide key ("calendar-days" is both Programs & batches and the
// booking desk) and the mock draws them differently. The shared
// registry itself (lib/nav.ts, components/bottom-nav.tsx) is NOT
// changed: coach, reception and Ops keep the icons they have.
//
// Every destination the Owner navigation can show is listed here. A
// destination that is not listed falls back to the registry key, and
// that fallback is documented below rather than silent.
const OWNER_ICON_BY_HREF: Record<string, OwnerIconName> = {
  "/owner": "home",
  "/owner/members": "members",
  "/owner/schedule": "calendar",
  "/owner/bookings": "booking",
  "/owner/programs": "programs",
  "/owner/batches": "programs",
  // The mock has no sessions symbol of its own; the plain calendar is
  // the consistent outline for a schedule-shaped destination.
  "/owner/sessions": "calendar",
  // THE LEDGER: "Fees & payments" draws the approved MONEY glyph — the
  // wallet/ledger symbol of the mock, and the meaningful domain glyph
  // for money. It is not the "invoice" glyph: that one is the
  // collections invoice shortcut, not the ledger.
  "/owner/fees": "money",
  "/owner/enquiries": "enquiry",
  // The mock's bell is the notification symbol; announcements is the
  // owner's notification-shaped destination.
  "/owner/announcements": "bell",
  "/owner/staff": "staff",
  "/owner/reports": "reports",
  "/owner/settings": "settings",
};

// The registry-key fallback, for a destination the Owner tree has not
// mapped yet. It keeps a consistent existing thin outline instead of
// silently substituting unrelated imagery.
const OWNER_ICON_BY_REGISTRY_KEY: Record<string, OwnerIconName> = {
  "layout-dashboard": "home",
  "users": "members",
  "calendar-range": "calendar",
  "calendar-days": "calendar",
  receipt: "money",
  "clipboard-list": "enquiry",
  megaphone: "bell",
  briefcase: "staff",
  "file-text": "reports",
  settings: "settings",
  "user-cog": "staff",
  "user-plus": "userplus",
  "user-round": "members",
  "list-checks": "check",
  "sliders-horizontal": "settings",
  "building-2": "home",
};

/**
 * The shared Owner icon name for one navigation item.
 *
 * The route and the permission filtering are untouched: this maps a
 * destination to a NAME and nothing else.
 *
 * A destination nobody mapped draws the NEUTRAL shared "more" glyph:
 * meaningful, never the house (which would say "Home" on a row that is
 * not Home) and never a crash that takes the owner shell down with it.
 * The explicit mapping table above is the contract, and
 * tests/owner-light-20261102/foundation/owner-icon-mapping.test.tsx
 * fails when a registry destination is missing from it.
 */
export function ownerIconName(item: {
  href: string;
  iconName: string;
}): OwnerIconName {
  const byHref = OWNER_ICON_BY_HREF[item.href];
  if (byHref) return byHref;
  return OWNER_ICON_BY_REGISTRY_KEY[item.iconName] ?? "more";
}
