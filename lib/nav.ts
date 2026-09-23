import type { NavItem } from "@/components/bottom-nav";
import {
  surfaceForRole,
  type TenantSurface,
} from "@/lib/auth/surface-access";

// O-06 — the tenant surfaces' bottom-nav definitions, extracted from
// the layouts so the ops effective-configuration viewer renders
// exactly what a role would see rather than a copy that can drift.
// The layouts remain the source of the frame; this is the item list.

// PR3-C3 — Fees is reachable from owner Home and the desktop sidebar.
// The mobile bottom nav stays four items (design contract), so this
// list is rendered by OwnerSideNav only, never by BottomNav.
export const OWNER_SIDEBAR_EXTRA_NAV: NavItem[] = [
  { href: "/owner/fees", label: "Fees", iconName: "receipt" },
];

export const TENANT_SURFACE_NAV: Record<TenantSurface, NavItem[]> = {
  owner: [
    { href: "/owner", label: "Home", iconName: "layout-dashboard", exact: true },
    { href: "/owner/members", label: "Members", iconName: "users" },
    { href: "/owner/reports", label: "Reports", iconName: "file-text" },
    { href: "/owner/settings", label: "Settings", iconName: "settings" },
  ],
  coach: [
    { href: "/coach", label: "Today", iconName: "list-checks", exact: true },
    { href: "/coach/schedule", label: "Schedule", iconName: "calendar-days" },
    { href: "/coach/members", label: "Members", iconName: "users" },
    { href: "/coach/me", label: "Me", iconName: "user-round" },
  ],
  reception: [
    { href: "/reception", label: "Today", iconName: "calendar-days", exact: true },
    { href: "/reception/members/new", label: "Add member", iconName: "user-plus" },
    { href: "/reception/enquiries", label: "Enquiries", iconName: "clipboard-list" },
    { href: "/reception/me", label: "Me", iconName: "user-round" },
  ],
  // The worker role maps to the parent surface placeholder; it has no
  // tenant nav today (docs/role-surfaces-plan.md).
  parent: [],
};

export function navForRole(roleKey: string): NavItem[] {
  const surface = surfaceForRole(roleKey);
  return surface ? TENANT_SURFACE_NAV[surface] : [];
}
