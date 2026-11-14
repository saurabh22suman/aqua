import type { NavItem } from "@/components/bottom-nav";

// Ops redesign (28 October 2026) — the operator console's navigation
// contract.
//
// ONE registry drives every Ops navigation surface: the desktop rail,
// the phone Menu panel, the shared context strip and the Overview's
// task list. A destination therefore cannot appear in one surface and
// be missing from another, and the active-route resolution below is
// the SAME function the tenant bottom bar uses, so the rail and the
// bar can never disagree about where the operator is.
//
// THE DESTINATIONS ARE GROUPED BY TASK (9 November 2026). Nine
// unranked peers gave the operator no answer to "what belongs to the
// task I am in the middle of?". The four groups below are the whole
// console:
//
//   Overview            the console itself
//   Clubs and leads    the clubs, and the people who want to become one
//   Catalogue and presets  what Aqua ships, and the templates applied to it
//   Operations         messaging, recovery and the audit trail
//
// The group's FLAT ORDER is unchanged from the flat list it replaces:
// /ops, /ops/tenants, /ops/leads, /ops/features, /ops/catalogue,
// /ops/presets, /ops/whatsapp, /ops/recovery, /ops/activity. Grouping
// adds structure; it never adds, drops or reorders a destination.
//
// `/ops` is an EXACT match: it is the overview, not a parent of every
// other destination. `/ops/tenants`, `/ops/leads` and `/ops/presets`
// stay lit on their own children, so a tenant detail page still shows
// "Tenants" as the current section.
//
// The label of a destination is the SAME WORD on every surface — the
// rail, the phone Menu, the context strip and the Overview's task list
// all read it from here. The WhatsApp screen says in large letters
// that it is a mock and that it 404s outside the mock provider, so the
// navigation calls it "WhatsApp mock" rather than implying a live
// channel.

export type OpsIconName =
  | "layout-dashboard"
  | "building-2"
  | "clipboard-list"
  | "list-checks"
  | "sliders-horizontal"
  | "message-circle"
  | "activity"
  | "layers"
  | "life-buoy"
  | "server"
  | "users";

export type OpsNavigationRole = "admin" | "viewer";

export type OpsNavItem = {
  href: string;
  label: string;
  /** The lucide icon the concept uses for this destination. */
  icon: OpsIconName;
  /** Exact-match only; otherwise the destination stays lit on children. */
  exact?: boolean;
  /** Presentation only. The page and actions still enforce administrator access. */
  adminOnly?: boolean;
};

/** A named task area of the console. */
export type OpsNavGroup = {
  id: string;
  /** The group's visible label, and its accessible name. */
  label: string;
  items: readonly OpsNavItem[];
};

export const OPS_NAV_GROUPS: readonly OpsNavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { href: "/ops", label: "Overview", icon: "layout-dashboard", exact: true },
    ],
  },
  {
    id: "clubs",
    label: "Clubs and leads",
    items: [
      { href: "/ops/tenants", label: "Tenants", icon: "building-2" },
      { href: "/ops/leads", label: "Leads", icon: "clipboard-list" },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue and presets",
    items: [
      { href: "/ops/features", label: "Feature catalogue", icon: "list-checks" },
      { href: "/ops/catalogue", label: "SaaS plans", icon: "layers" },
      { href: "/ops/presets", label: "Presets", icon: "sliders-horizontal" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/ops/whatsapp", label: "WhatsApp mock", icon: "message-circle" },
      { href: "/ops/recovery", label: "Recovery", icon: "life-buoy", adminOnly: true },
      { href: "/ops/system", label: "System", icon: "server", adminOnly: true },
      { href: "/ops/operators", label: "Operators", icon: "users", adminOnly: true },
      { href: "/ops/activity", label: "Activity log", icon: "activity" },
    ],
  },
];

/** Every destination, in the flat order the rail renders. */
export const OPS_NAV_ITEMS: readonly OpsNavItem[] = OPS_NAV_GROUPS.flatMap(
  (group) => group.items,
);

/**
 * The shared active-route resolution (components/bottom-nav.tsx), fed
 * the Ops destinations. The resolver only reads href/exact, so the
 * icon slot is filled from the shared registry to satisfy the type.
 */
export const OPS_ROUTE_RESOLUTION: readonly NavItem[] = OPS_NAV_GROUPS.flatMap(
  (group) =>
    group.items.map((item) => ({
      href: item.href,
      label: item.label,
      iconName: "briefcase",
      exact: item.exact,
    })),
);

/**
 * The groups a role may see. A group whose destinations are ALL
 * hidden for the role is dropped entirely — no orphan label and no
 * empty list in the navigation.
 */
export function opsNavGroupsForRole(
  role: OpsNavigationRole,
): readonly OpsNavGroup[] {
  return OPS_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.adminOnly || role === "admin",
    ),
  })).filter((group) => group.items.length > 0);
}

/** Filter visible destinations using the server-verified role; this grants no access. */
export function opsNavItemsForRole(
  role: OpsNavigationRole,
): readonly OpsNavItem[] {
  return opsNavGroupsForRole(role).flatMap((group) => group.items);
}

/** The group that owns a destination, and the destination itself. */
export function opsNavTargetFor(
  href: string,
): { group: OpsNavGroup; item: OpsNavItem } | null {
  for (const group of OPS_NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.href === href);
    if (item) return { group, item };
  }
  return null;
}
