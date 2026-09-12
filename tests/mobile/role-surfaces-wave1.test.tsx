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
import ParentPage from "@/app/(parent)/parent/page";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import type { MemberListRow } from "@/lib/services/people";

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

const DASHBOARD: OwnerDashboardData = {
  tenantName: "Aqua Worli",
  today: "2026-09-12",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 32,
  attendanceThisWeekPct: null,
  activeBatchCount: 4,
  needsAttention: [],
  todaysLanes: [],
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
    render(<ParentPage />);
    expect(document.body.textContent).toMatch(/club|academy/i);
    expect(document.body.textContent).toMatch(/link/i);
  });
});

describe("W1-4 owner Home quick links (F26)", () => {
  it("surfaces Enquiries, Programs/Sessions, Staff and Onboarding", () => {
    render(
      <OwnerDashboard data={DASHBOARD} branding={BRANDING} terminology={TERMINOLOGY} />,
    );
    for (const href of [
      "/owner/enquiries",
      "/owner/programs",
      "/owner/staff",
      "/owner/onboarding",
    ]) {
      expect(
        document.querySelector(`a[href="${href}"]`),
        `missing quick link ${href}`,
      ).toBeTruthy();
    }
  });
});

describe("W1-5 member joined date", () => {
  it("renders the joining date on the member row", () => {
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
    expect(document.body.textContent).toContain("Joined 1 Sept 2026");
  });
});
