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
// The mobile bottom nav stays four items (design contract), so the
// desktop-only extras are rendered by OwnerSideNav only, never by
// BottomNav.
//
// W1-6 continuation — the owner dashboard used to carry Fees,
// Enquiries, Programs and Staff as a quick-link grid because the
// desktop sidebar had only one extra. The grid stays below lg as the
// phone access path; at lg+ these now live in the grouped sidebar
// (Main / Operations / Insights / Settings), matching the cockpit
// layout every club-management competitor uses and keeping each group
// within the 7-item navigation scan limit.
export type OwnerSidebarGroup = { label: string; items: NavItem[] };

export const OWNER_SIDEBAR_GROUPS: OwnerSidebarGroup[] = [
  {
    label: "Main",
    items: [
      { href: "/owner", label: "Home", iconName: "layout-dashboard", exact: true },
      { href: "/owner/members", label: "Members", iconName: "users" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/owner/fees", label: "Fees & payments", iconName: "receipt" },
      { href: "/owner/enquiries", label: "Enquiries", iconName: "clipboard-list" },
      // C04 (2026-10-09 role/content/permission audit §9) — announcements
      // are recurring communication work, so the desktop sidebar carries the
      // entry point; the Settings → Announcements link stays on the
      // same route (no second implementation). Desktop only: the mobile
      // bottom nav stays at the four-item design contract.
      { href: "/owner/announcements", label: "Announcements", iconName: "megaphone" },
      { href: "/owner/staff", label: "Staff", iconName: "briefcase" },
    ],
  },
  {
    // Owner UX audit (2026-10-24): "Programs & sessions", "Sessions"
    // and "Schedule" were three destinations in one flat group, and
    // they competed — the owner could not tell which one answered
    // "when is it on?". They are the same job (when, what and who
    // covers it), so they now sit under one group. The routes and
    // the pages are untouched; only the grouping and one redundant
    // label changed.
    label: "Scheduling",
    items: [
      { href: "/owner/programs", label: "Programs & batches", iconName: "calendar-days" },
      // R10 (2026-10-13 role-workflow audit) — scheduling management and
      // the read-only grid were reachable only by drilling through
      // Programs. They stay owner/admin-only (Programs gate is
      // programs.read; Sessions needs programs.write, Schedule needs
      // attendance.read), matching the management authority the pages
      // already enforce.
      { href: "/owner/sessions", label: "Sessions", iconName: "user-cog" },
      { href: "/owner/schedule", label: "Schedule", iconName: "calendar-range" },
    ],
  },
  {
    label: "Insights",
    items: [{ href: "/owner/reports", label: "Reports", iconName: "file-text" }],
  },
  {
    label: "Account",
    items: [{ href: "/owner/settings", label: "Settings", iconName: "settings" }],
  },
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
  // R08 — the worker surface renders its own self-service cards and a
  // sign-out; it deliberately has no bottom nav (there is no second
  // destination in the worker charter).
  worker: [],
  // A parent has no tenant session/nav; /p/[token] is the surface.
  parent: [],
};

// C01 (docs/audits/2026-10-09-role-content-permission-audit.md §9) — the
// owner surface is shared by Owner, Administrator and Accountant, but
// only the first two hold the full grant set. An entry appears only when
// the caller's resolved permission set satisfies its gate, so the
// Accountant sees a finance-shaped frame (Home → Fees, Members,
// Fees & payments, Reports) instead of Owner-only destinations whose
// actions refuse them. The map is data keyed by href, not a role branch
// (F-04's "never branch on role key at runtime"); ungated entries
// (Home, whose page redirects an Accountant to Fees) always show.
const OWNER_NAV_PERMISSION_GATES: Readonly<Record<string, string>> = {
  "/owner/members": "members.read",
  "/owner/fees": "invoices.read",
  "/owner/enquiries": "enquiries.read",
  // C04 — the announcements page's reason to exist is composing; its
  // send action requires messaging.send (owner/admin). A reader without
  // it (the Accountant) keeps the finance-shaped frame.
  "/owner/announcements": "messaging.send",
  "/owner/programs": "programs.read",
  // R10 — management scheduling and the read-only grid, now first-class
  // sidebar destinations.
  "/owner/sessions": "programs.write",
  "/owner/schedule": "attendance.read",
  "/owner/staff": "staff.read",
  "/owner/reports": "reports.operational",
  "/owner/settings": "settings.manage",
};

export function filterOwnerNavItems(
  items: NavItem[],
  permissions: ReadonlySet<string>,
): NavItem[] {
  return items.filter((item) => {
    const gate = OWNER_NAV_PERMISSION_GATES[item.href];
    return !gate || permissions.has(gate);
  });
}

export function ownerNavForPermissions(
  permissions: ReadonlySet<string>,
): NavItem[] {
  return filterOwnerNavItems(TENANT_SURFACE_NAV.owner, permissions);
}

export function ownerSidebarGroupsForPermissions(
  permissions: ReadonlySet<string>,
): OwnerSidebarGroup[] {
  return OWNER_SIDEBAR_GROUPS.map((group) => ({
    label: group.label,
    items: filterOwnerNavItems(group.items, permissions),
  })).filter((group) => group.items.length > 0);
}

export function navForRole(roleKey: string): NavItem[] {
  const surface = surfaceForRole(roleKey);
  return surface ? TENANT_SURFACE_NAV[surface] : [];
}
