// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Wave 1 of docs/role-surfaces-plan.md (2026-09-13).
//   W1-2 dead /platform links and redirects
//   W1-3 parent stub explainer
//   W1-4 owner Home quick-links grid (F26 resolution)
//   W1-5 member joined date
// TDD: each assertion below fails before the fix.

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
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/tenant-auth", () => ({ logoutTenantAction: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction: vi.fn() }));

import { OwnerDashboard } from "@/components/owner-dashboard";
import { MembersBoard } from "@/components/members-board";
import { ParentLinkExplainer } from "@/components/parent-link-explainer";
import { ownerSidebarGroupsForPermissions } from "@/lib/nav";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import type { MemberListRow } from "@/lib/services/people";

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

const DASHBOARD: OwnerDashboardData = {
  tenantName: "Aqua Worli",
    scopeLocationName: null,
  today: "2026-09-12",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 32,
  attendanceThisWeekPct: null,
  activeBatchCount: 4,
  money: {
    collectedTodayPaise: 0,
    collectedTodayCount: 0,
    outstandingPaise: 0,
    dueInvoiceCount: 0,
    overduePaise: 0,
    overdueInvoiceCount: 0,
      oldestOverdueDays: null,
  },
  needsAttention: [],
  todaysLanes: [],
  nextClass: null,
  facilityBreakdown: [],
};

const BRANDING = {
  displayName: "Aqua Worli",
  shortName: "AW",
  accent: "mango",
  fallbackDisplayName: "Aqua Worli",
  fallbackShortName: "AW",
  initials: "AW",
} as BrandingData;

afterEach(cleanup);

describe("W1-2 no dead /platform links", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("no app file links or redirects to /platform", () => {
    const hits = walk("app").filter((f) =>
      readFileSync(f, "utf8").includes('"/platform"'),
    );
    expect(hits, `dead /platform references:\n${hits.join("\n")}`).toEqual([]);
  });
});

describe("W1-3 parent explainer (not a bare stub)", () => {
  it("explains how parents get their link", () => {
    // P-D3 (2026-09-13 UI/UX audit): the role check moved from the
    // (parent) layout into the page so its 404 can render this same
    // explainer. The content test renders the shared component; the
    // page's gate is exercised by the role-gating suites.
    render(<ParentLinkExplainer />);
    expect(document.body.textContent).toMatch(/club|academy/i);
    expect(document.body.textContent).toMatch(/link/i);
  });
});

describe("W1-4 owner Home quick links (F26)", () => {
  it("surfaces Enquiries, Programs/Sessions and Staff; onboarding only for a new academy", () => {
    const { rerender } = render(
      <OwnerDashboard data={DASHBOARD} branding={BRANDING} terminology={TERMINOLOGY} />,
    );
    // Approved Home no longer duplicates the shell's task navigation.
    const navigation = ownerSidebarGroupsForPermissions(new Set(["enquiries.read","programs.read","staff.read"])).flatMap(group => group.items);
    for (const href of ["/owner/enquiries", "/owner/programs", "/owner/staff"]) expect(navigation.some(item => item.href === href)).toBe(true);
    expect(ownerSidebarGroupsForPermissions(new Set()).flatMap(group => group.items).some(item => item.href === "/owner/staff")).toBe(false);
    // An established academy is not nagged with the setup checklist.
    expect(document.querySelector('a[href="/owner/onboarding"]')).toBeNull();

    rerender(
      <OwnerDashboard
        data={DASHBOARD}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        showOnboarding
      />,
    );
    expect(document.querySelector('a[href="/owner/onboarding"]')).toBeTruthy();
  });
});

describe("W1-5 member joined date", () => {
  // Owner UX audit (2026-10-24): the roster gave the joined date the
  // same weight as the member, and the phone shared a line with the
  // code and location on a phone, so it wrapped mid-number. The
  // joined date is context the member's OWN page carries (the roster
  // no longer shows it); the phone stays, on its own line, readable.
  it("leaves the joined date to the member's own page", () => {
    const row = {
      memberId: "m1",
      fullName: "Aadhya Sharma",
      isMinor: true,
      memberCode: "AWS-010",
      locationName: "Worli Main",
      phone: "+919812340010",
      status: "active",
      createdAt: "2026-09-01T06:00:00.000Z",
      joinedOn: "2026-09-01",
    } as MemberListRow;
    render(<MembersBoard initialMembers={[row]} />);
    expect(document.body.textContent).not.toContain("Joined 1 Sept 2026");
    // The business context the row does carry is still there.
    expect(document.body.textContent).toContain("Aadhya Sharma");
    expect(document.body.textContent).toContain("AWS-010");
    expect(document.body.textContent).toContain("Worli Main");
  });

describe("members desktop columns (PR3-C4)", () => {
  it("renders the compact member row with its business details and unbroken phone", () => {
    const row = {
      memberId: "m1",
      fullName: "Aadhya Sharma",
      isMinor: true,
      memberCode: "AWS-010",
      locationName: "Worli Main",
      phone: "+919812340010",
      status: "active",
      createdAt: "2026-09-01T06:00:00.000Z",
      joinedOn: "2026-09-01",
    } as MemberListRow;
    render(<MembersBoard initialMembers={[row]} />);

    const link = document.querySelector('[data-testid="member-row"]');
    expect(link?.getAttribute("href")).toContain("/owner/members/m1");
    expect(link?.textContent).toContain("Aadhya Sharma");
    expect(link?.textContent).toContain("AWS-010");
    expect(link?.textContent).toContain("Worli Main");
    expect(link?.textContent).toContain("Active");
    const phone = document.querySelector('[data-testid="member-row-phone"]');
    expect(phone?.textContent).toContain("+91 98123 40010");
    expect(phone?.className).toContain("whitespace-nowrap");
    expect(link?.textContent).not.toContain("Joined");
  });
});
});
