import type { NavItem } from "@/components/bottom-nav";

// Ops redesign (28 October 2026) — the operator console's navigation
// contract.
//
// ONE list drives every Ops navigation surface: the desktop rail, the
// phone Menu panel and (as its four-item subset) the phone bottom bar.
// A destination therefore cannot appear in one surface and be missing
// from another, and the active-route resolution below is the SAME
// function the tenant bottom bar uses, so the rail and the bar can
// never disagree about where the operator is.
//
// The order is the approved concept's order, and the existing
// tests/mobile/platform-mobile-shell.test.tsx pins it.
//
// `/ops` is an EXACT match: it is the overview, not a parent of every
// other destination. `/ops/tenants`, `/ops/leads` and `/ops/presets`
// stay lit on their own children, so a tenant detail page still shows
// "Tenants" as the current section.

export type OpsIconName =
  | "layout-dashboard"
  | "building-2"
  | "clipboard-list"
  | "list-checks"
  | "sliders-horizontal"
  | "message-circle"
  | "activity";

export type OpsNavItem = {
  href: string;
  label: string;
  /** The lucide icon the concept uses for this destination. */
  icon: OpsIconName;
  /** Exact-match only; otherwise the destination stays lit on children. */
  exact?: boolean;
};

export const OPS_NAV_ITEMS: readonly OpsNavItem[] = [
  { href: "/ops", label: "Overview", icon: "layout-dashboard", exact: true },
  { href: "/ops/tenants", label: "Tenants", icon: "building-2" },
  { href: "/ops/leads", label: "Leads", icon: "clipboard-list" },
  { href: "/ops/features", label: "Feature catalogue", icon: "list-checks" },
  { href: "/ops/presets", label: "Presets", icon: "sliders-horizontal" },
  { href: "/ops/whatsapp", label: "WhatsApp", icon: "message-circle" },
  { href: "/ops/activity", label: "Activity log", icon: "activity" },
];

/**
 * The shared active-route resolution (components/bottom-nav.tsx), fed
 * the Ops destinations. The resolver only reads href/exact, so the
 * icon slot is filled from the shared registry to satisfy the type.
 */
export const OPS_ROUTE_RESOLUTION: readonly NavItem[] = OPS_NAV_ITEMS.map(
  (item) => ({
    href: item.href,
    label: item.label,
    iconName: "briefcase",
    exact: item.exact,
  }),
);
