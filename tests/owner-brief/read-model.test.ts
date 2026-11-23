import { describe, expect, it } from "vitest";
import {
  buildOwnerHomeBriefView,
  formatBriefPeriod,
} from "@/lib/services/owner-home-brief";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { BrandingData } from "@/lib/services/branding";

// 21 November 2026 — the owner brief read model.
//
// These assertions are the brief's observable behavior: one stated seven-day
// window plus today, a durable balance, overdue grouped with age, a structured
// cash review, real scoped links and only the caller's facilities. No value is
// fabricated when a read is missing.

const BRANDING = {
  displayName: "Aqua Worli",
  shortName: "Aqua Worli",
  accent: "marine",
  fallbackDisplayName: "Aqua Worli",
  fallbackShortName: "Aqua Worli",
  initials: "AW",
} as BrandingData;

const LOCATIONS = [
  { id: "11111111-1111-7111-8111-111111111111", name: "Worli Main" },
  { id: "22222222-2222-7222-8222-222222222222", name: "Worli Annexe" },
];

const DATA = {
  tenantName: "Aqua Worli",
  scopeLocationName: "Worli Main",
  today: "2026-11-21",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 42,
  attendanceThisWeekPct: null,
  activeBatchCount: 4,
  needsAttention: [
    { title: "Follow-up overdue", detail: "Trial follow-up — due 2 days ago", href: "/owner/enquiries/e1" },
  ],
  todaysLanes: [
    {
      sessionId: "s1",
      batchId: "b1",
      batchName: "Junior squad",
      programName: "Swim",
      startTime: "17:00:00",
      enrolled: 8,
      capacity: 12,
      coachName: "Coach Bhaskar",
      marked: 0,
      started: false,
      startsAt: "2026-11-21T11:30:00.000Z",
      locationName: "Worli Main",
    },
  ],
  nextClass: null,
  money: {
    collectedTodayPaise: 1_060_000,
    collectedTodayCount: 2,
    outstandingPaise: 9_850_000,
    dueInvoiceCount: 6,
    overduePaise: 2_100_000,
    overdueInvoiceCount: 3,
    oldestOverdueDays: 12,
  },
  cashReview: {
    locationId: LOCATIONS[0]!.id,
    locationName: "Worli Main",
    onDate: "2026-11-20",
    variancePaise: -85_000,
  },
  facilityBreakdown: [],
} as OwnerDashboardData;

const CHARTS = {
  timezone: "Asia/Kolkata",
  period: {
    key: "last7",
    tabLabel: "Last 7 days",
    comparisonLabel: "7-day",
    comparisonMeaning: "",
    currentLabel: "",
    previousLabel: "",
    currentFromDate: "2026-11-15",
    currentToDate: "2026-11-21",
    previousFromDate: "2026-11-08",
    previousToDate: "2026-11-14",
    previousCapped: false,
    capNote: null,
  },
  collections: {
    buckets: [
      { key: "2026-11-15", label: "Sun 15", fullLabel: "15 Nov 2026", cash: 0, digital: 0, other: 0, totalPaise: 0 },
      { key: "2026-11-20", label: "Fri 20", fullLabel: "20 Nov 2026", cash: 0, digital: 0, other: 0, totalPaise: 100_000 },
      { key: "2026-11-21", label: "Sat 21", fullLabel: "21 Nov 2026", cash: 0, digital: 0, other: 0, totalPaise: 1_060_000 },
    ],
    groups: [],
    methods: [],
    totalPaise: 1_060_000,
    paymentCount: 2,
    previousTotalPaise: 0,
    previousPaymentCount: 0,
    previousIsZero: true,
    reversedPaise: 0,
    reversalCount: 0,
    comparison: "",
  },
  attendance: {
    buckets: [],
    present: 0,
    total: 0,
    pct: null,
    previousPresent: 0,
    previousTotal: 0,
    previousPct: null,
    comparison: "",
  },
} as OwnerChartsData;

const CAN = { fees: true, schedule: true, enquiries: true };

describe("owner Home brief read model", () => {
  it("carries recorded seven days, today, balance, overdue and the real period", () => {
    const view = buildOwnerHomeBriefView({
      data: DATA,
      charts: CHARTS,
      facilities: LOCATIONS,
      branding: BRANDING,
      requestedFacility: null,
      can: CAN,
    });
    expect(view.money?.last7Paise).toBe(1_060_000);
    expect(view.money?.todayPaise).toBe(1_060_000);
    expect(view.money?.outstandingPaise).toBe(9_850_000);
    expect(view.money?.overdueInvoiceCount).toBe(3);
    expect(view.money?.oldestOverdueDays).toBe(12);
    expect(view.money?.periodLabel).toBe(formatBriefPeriod("2026-11-15", "2026-11-21"));
    expect(view.money?.days).toHaveLength(3);
  });

  it("keeps a failed collection read unavailable rather than zero", () => {
    const view = buildOwnerHomeBriefView({
      data: DATA,
      charts: null,
      facilities: LOCATIONS,
      branding: BRANDING,
      requestedFacility: null,
      can: CAN,
    });
    expect(view.money?.last7Paise).toBeNull();
    expect(view.money?.todayPaise).toBe(1_060_000);
    expect(view.money?.periodLabel).toBe("15–21 Nov 2026");
  });

  it("carries the structured cash review and the scoped links", () => {
    const view = buildOwnerHomeBriefView({
      data: DATA,
      charts: CHARTS,
      facilities: LOCATIONS,
      branding: BRANDING,
      requestedFacility: LOCATIONS[1]!.id,
      can: CAN,
    });
    expect(view.cashReview?.variancePaise).toBe(-85_000);
    expect(view.scopeLabel).toBe("Worli Annexe");
    expect(view.overdueHref).toContain("tab=dues");
    expect(view.overdueHref).toContain("overdue=1");
    expect(view.overdueHref).toContain(`facility=${LOCATIONS[1]!.id}`);
    expect(view.cashHref).toContain(`facility=${LOCATIONS[1]!.id}`);
    expect(view.session?.href).toContain(`facility=${LOCATIONS[1]!.id}`);
  });

  it("lists only the supplied authorized facilities and keeps the follow-up workflow", () => {
    const view = buildOwnerHomeBriefView({
      data: DATA,
      charts: CHARTS,
      facilities: [LOCATIONS[0]!],
      branding: BRANDING,
      requestedFacility: null,
      can: CAN,
    });
    expect(view.multiFacility).toBe(false);
    expect(view.facilities).toEqual([LOCATIONS[0]]);
    expect(view.scopeLabel).toBe("Worli Main");
    expect(view.followUps?.count).toBe(1);
    expect(view.followUps?.href).toBe("/owner/enquiries/e1");
  });
});
