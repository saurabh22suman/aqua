import type { NavItem } from "@/components/bottom-nav";
import { scheduleDestination } from "@/lib/owner-scope/schedule";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import { ownerTerm } from "@/lib/terminology/owner-terms";
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
      {
        href: "/owner/announcements",
        label: "Announcements",
        iconName: "megaphone",
        activePrefixes: ["/owner/inbox"],
      },
      { href: "/owner/staff", label: "Staff", iconName: "briefcase" },
    ],
  },
  {
    label: "Scheduling",
    items: [
      { href: "/owner/programs", label: "Programs & batches", iconName: "calendar-days", activePrefixes: ["/owner/batches"] },
      {
        href: "/owner/schedule",
        label: "Schedule",
        iconName: "calendar-range",
        activePrefixes: ["/owner/sessions"],
      },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/owner/reports", label: "Reports", iconName: "file-text" },
      { href: "/owner/settings", label: "Settings", iconName: "settings" },
    ],
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
    // The coach reaches the register FROM Today, and the register lives
    // under a different URL prefix (/coach/register). `activePrefixes`
    // is the declared way to say "this child route belongs to this
    // destination"; without it the register lit no tab at all.
    { href: "/coach", label: "Today", iconName: "list-checks", exact: true, activePrefixes: ["/coach/register"] },
    { href: "/coach/schedule", label: "Schedule", iconName: "calendar-days", activePrefixes: ["/coach/workday"] },
    { href: "/coach/members", label: "Members", iconName: "users" },
    { href: "/coach/me", label: "Me", iconName: "user-round", activePrefixes: ["/coach/announcements", "/coach/curriculum"] },
  ],
  reception: [
    { href: "/reception", label: "Today", iconName: "calendar-days", exact: true, activePrefixes: ["/reception/bookings", "/reception/collect-payment", "/reception/dues", "/reception/close", "/reception/cafe", "/reception/workday"] },
    // The member DIRECTORY, not a second create destination. The
    // contextual "+" on the directory (and the labelled desktop create)
    // is the one create path; a tab pointing at the same create URL
    // would offer the same task twice on one screen.
    { href: "/reception/members", label: "Members", iconName: "users" },
    { href: "/reception/enquiries", label: "Enquiries", iconName: "clipboard-list" },
    { href: "/reception/me", label: "Me", iconName: "user-round", activePrefixes: ["/reception/announcements"] },
  ],
  worker: [
    { href: "/worker", label: "Today", iconName: "layout-dashboard", exact: true, activePrefixes: ["/worker/announcements"] },
    { href: "/worker/shifts", label: "Schedule", iconName: "calendar-days", activePrefixes: ["/worker/leave"] },
    { href: "/worker/me", label: "Me", iconName: "user-round" },
  ],
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
  terminology?: TerminologyState,
): NavItem[] {
  return labelMemberDestinations(filterOwnerNavItems(TENANT_SURFACE_NAV.owner, permissions), terminology);
}

export function ownerSidebarGroupsForPermissions(
  permissions: ReadonlySet<string>,
  terminology?: TerminologyState,
  features?: ReadonlySet<string>,
): OwnerSidebarGroup[] {
  const canPublish = permissions.has("messaging.send") && (features?.has("messaging") ?? true);
  const schedule = scheduleDestination(permissions);
  return OWNER_SIDEBAR_GROUPS.map((group) => {
    const destinations = group.items.map((item) => {
      if (item.href === "/owner/announcements" && !canPublish) {
        return { ...item, href: "/owner/inbox", activePrefixes: ["/owner/announcements"] };
      }
      if (item.href === "/owner/schedule" && schedule && schedule !== item.href) {
        return { ...item, href: schedule, activePrefixes: undefined };
      }
      return item;
    });
    return {
      label: group.label,
      items: labelMemberDestinations(filterOwnerNavItems(destinations, permissions), terminology),
    };
  }).filter((group) => group.items.length > 0);
}

function labelMemberDestinations(items: NavItem[], terminology?: TerminologyState): NavItem[] {
  if (!terminology) return items;
  const memberRoutes = new Set(["/owner/members", "/coach/members", "/reception/members"]);
  return items.map(item => memberRoutes.has(item.href) ? { ...item, label: titleCase(item.href === "/owner/members" ? ownerTerm(terminology, "member", "other") : resolveTerm(terminology, "member", "other")) } : item);
}

export function navForRole(roleKey: string, terminology?: TerminologyState): NavItem[] {
  if (roleKey === "manager" || roleKey === "admin") {
    const main = TENANT_SURFACE_NAV.owner;
    const schedule = OWNER_SIDEBAR_GROUPS.flatMap(group => group.items).find(item => item.href === "/owner/schedule");
    return labelMemberDestinations([
      { ...main[0], label: "Today" },
      ...(schedule ? [schedule] : []),
      main[1],
    ], terminology);
  }
  const surface = surfaceForRole(roleKey);
  return surface ? labelMemberDestinations(TENANT_SURFACE_NAV[surface], terminology) : [];
}

/** Read one owner navigation gate without exporting the mutable registry. */
export function ownerNavPermissionGate(href: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(OWNER_NAV_PERMISSION_GATES, href)
    ? OWNER_NAV_PERMISSION_GATES[href]
    : undefined;
}
