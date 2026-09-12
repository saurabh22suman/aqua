// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// P1-4, P1-5, P1-6, P1-8, P1-9 + the cheap P2 copy fixes from the
// 2026-09-12 mobile UX audit:
//   P1-4 owner had no one-tap sign-out (settings only);
//   P1-5 non-actionable "Needs you today" rows showed the same chevron
//        as linked ones;
//   P1-6 empty sessions rendered a bare "0 / 0" + empty bar;
//   P1-8 coach roster omitted the (minor) tag owner has;
//   P1-9 the tag needs a space in the accessible text;
//   P2-1 attendance report "—" was ambiguous;
//   P2-8/P2-9 empty inline fields looked like plain text / "—".

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
}));
vi.mock("@/lib/actions/tenant-auth", () => ({ logoutTenantAction: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ updateMemberAction: vi.fn() }));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ overrides: {}, locale: "en" }),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireCoach: async () => ({}),
  requireReception: async () => ({}),
}));

const homeAction = vi.hoisted(() => ({
  value: { sessions: [] as unknown[], next: null as unknown },
}));
const todayAction = vi.hoisted(() => ({ value: { sessions: [] as unknown[] } }));
vi.mock("@/lib/actions/coach", () => ({
  getCoachHomeAction: async () => homeAction.value,
  getTodayAction: async () => todayAction.value,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import { CoachRosterSearch } from "@/components/coach-roster-search";
import { AttendanceReportCard } from "@/components/reports/attendance-report-card";
import { InlineEditField } from "@/components/member-detail/inline-edit-field";
import CoachHomePage from "@/app/(coach)/coach/page";
import ReceptionTodayPage from "@/app/(reception)/reception/page";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import type { CoachRosterRow } from "@/lib/services/coach-schedule";

const SNAPSHOT = {
  fullName: "Arjun Mehta",
  dateOfBirth: "2015-01-01",
  locationId: "11111111-1111-1111-1111-111111111111",
  phone: null,
  gender: null,
  medicalNotes: null,
} as const;

const DASHBOARD: OwnerDashboardData = {
  tenantName: "Aqua Worli",
  today: "2026-09-12",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 32,
  attendanceThisWeekPct: null,
  activeBatchCount: 4,
  needsAttention: [
    { title: "Register not started", detail: "Junior TTS · 5:00 pm" },
    {
      title: "Follow-up overdue",
      detail: "Aarav's parent",
      href: "/owner/enquiries/e1",
    },
  ],
  todaysLanes: [
    {
      batchId: "b1",
      batchName: "Junior TTS",
      programName: "Learn to Swim",
      startTime: "17:00:00",
      enrolled: 8,
      capacity: 12,
    },
  ],
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

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

afterEach(cleanup);

describe("owner dashboard affordances (P1-4, P1-5, P1-7)", () => {
  it("offers one-tap sign-out in the header", () => {
    render(
      <OwnerDashboard data={DASHBOARD} branding={BRANDING} terminology={TERMINOLOGY} />,
    );
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("shows the chevron only on linked needs-attention rows", () => {
    render(
      <OwnerDashboard data={DASHBOARD} branding={BRANDING} terminology={TERMINOLOGY} />,
    );
    expect(document.querySelectorAll(".lucide-chevron-right")).toHaveLength(1);
  });

  it("renders lane times in 12-hour IST format", () => {
    render(
      <OwnerDashboard data={DASHBOARD} branding={BRANDING} terminology={TERMINOLOGY} />,
    );
    expect(document.body.textContent).toContain("5:00 pm");
    expect(document.body.textContent).not.toContain("17:00");
  });
});

describe("coach roster minor tag (P1-8, P1-9)", () => {
  it("marks minors with an accessible space before the tag", () => {
    const roster = [
      {
        memberId: "m1",
        name: "Aadhya Sharma",
        code: "AWS-010",
        batches: ["Morning Squad"],
        isMinor: true,
      },
    ] as CoachRosterRow[];
    render(<CoachRosterSearch roster={roster} />);
    expect(document.body.textContent).toContain("Aadhya Sharma (minor)");
  });
});

describe("empty session progress (P1-6)", () => {
  it("coach home says No one enrolled instead of 0 / 0", async () => {
    homeAction.value = {
      sessions: [
        {
          id: "s1",
          startsAt: new Date("2026-09-12T11:30:00.000Z"),
          batchName: "Junior TTS",
          marked: 0,
          total: 0,
        },
      ],
      next: null,
    };
    render(await CoachHomePage());
    expect(document.body.textContent).toContain("No one enrolled");
    expect(document.body.textContent).not.toContain("0 / 0");
  });

  it("reception today says No one enrolled instead of 0 / 0", async () => {
    todayAction.value = {
      sessions: [
        {
          id: "s1",
          startsAt: new Date("2026-09-12T11:30:00.000Z"),
          batchName: "Junior TTS",
          marked: 0,
          total: 0,
        },
      ],
    };
    render(await ReceptionTodayPage());
    expect(document.body.textContent).toContain("No one enrolled");
    expect(document.body.textContent).not.toContain("0 / 0");
  });
});

describe("attendance report empty percentage (P2-1)", () => {
  it("spells out that no attendance was recorded", async () => {
    render(
      await AttendanceReportCard({
        rows: [
          {
            batchId: "b1",
            batchName: "Junior TTS",
            programName: "Learn to Swim",
            sessionCount: 0,
            presentMarks: 0,
            totalMarks: 0,
            pct: null,
          },
        ],
        period: { from: "2026-09-01", to: "2026-10-01" },
      }),
    );
    expect(document.body.textContent).toContain("No attendance recorded");
    expect(document.body.textContent).not.toContain("—");
  });
});

describe("empty inline fields look editable (P2-8, P2-9)", () => {
  it("keeps the edit control visible when a field is empty", () => {
    render(
      <InlineEditField
        value=""
        field="medicalNotes"
        memberId="m1"
        type="textarea"
        snapshot={SNAPSHOT}
        placeholder="Add medical notes"
      />,
    );
    const button = screen.getByLabelText("Edit medicalNotes");
    expect(button.className).toContain("opacity-100");
    expect(button.className).not.toContain("opacity-0");
  });

  it("renders a supplied empty-state placeholder instead of a dash", () => {
    render(
      <InlineEditField
        value=""
        field="gender"
        memberId="m1"
        type="select"
        snapshot={SNAPSHOT}
        placeholder="Not recorded"
      />,
    );
    expect(document.body.textContent).toContain("Not recorded");
  });
});

describe("ops jargon copy sweep (P2-5)", () => {
  it("removes soft-deleted and E.164 from operator-facing copy", () => {
    const detail = readFileSync(
      "app/(platform)/ops/tenants/[tenantId]/page.tsx",
      "utf8",
    );
    const invite = readFileSync(
      "app/(platform)/ops/tenants/[tenantId]/invite-owner-form.tsx",
      "utf8",
    );
    expect(detail).not.toContain("soft-deleted");
    expect(invite).not.toContain("E.164");
  });
});
