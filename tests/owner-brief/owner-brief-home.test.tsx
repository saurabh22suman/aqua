// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/actions/owner-home-brief", () => ({
  getOwnerHomeBriefAction: vi.fn(),
  getOwnerHomeFacilityMoneyAction: vi.fn(),
}));

vi.mock("@/lib/actions/schedule-grid", () => ({ getScheduleGridAction: vi.fn() }));

import { getScheduleGridAction } from "@/lib/actions/schedule-grid";
import { OwnerBriefHome } from "@/components/owner-home/owner-brief/owner-brief-home";
import type { OwnerBriefView } from "@/lib/services/owner-home-brief";

afterEach(cleanup);

const VIEW: OwnerBriefView = {
  facilityId: null,
  scopeLabel: "All facilities",
  facilities: [
    { id: "11111111-1111-7111-8111-111111111111", name: "Worli Main" },
    { id: "22222222-2222-7222-8222-222222222222", name: "Worli Annexe" },
  ],
  multiFacility: true,
  tenantShortName: "Aqua Worli",
  dateLabel: "Saturday, 21 November",
  todayIso: "2026-11-21",
  money: {
    last7Paise: 1_060_000,
    todayPaise: 270_000,
    outstandingPaise: 9_850_000,
    overduePaise: 2_100_000,
    overdueInvoiceCount: 3,
    oldestOverdueDays: 12,
    days: [
      { key: "2026-11-15", shortLabel: "15", fullLabel: "15 Nov 2026", paise: 790_000 },
      { key: "2026-11-21", shortLabel: "21", fullLabel: "21 Nov 2026", paise: 270_000 },
    ],
    periodLabel: "15–21 Nov 2026",
    todayCount: 2,
  },
  cashReview: {
    locationId: "11111111-1111-7111-8111-111111111111",
    locationName: "Worli Main",
    onDate: "2026-11-20",
    variancePaise: -85_000,
  },
  followUps: {
    count: 2,
    href: "/owner/enquiries/e1",
    label: "2 overdue enquiry follow-ups",
    detail: "Trial follow-up — due 2 days ago",
  },
  session: {
    timeLabel: "5:00 pm",
    title: "Junior squad",
    detail: "Worli Main · Coach Bhaskar",
    href: "/owner/schedule?date=2026-11-21&facility=all",
    isNextDay: false,
  },
  scheduleHref: "/owner/schedule?date=2026-11-21&facility=all",
  membersHref: "/owner/members?facility=all",
  enquiriesHref: "/owner/enquiries",
  feesHref: "/owner/fees?facility=all",
  overdueHref: "/owner/fees?tab=dues&overdue=1&facility=all",
  cashHref: "/owner/reports/collections?facility=all",
  can: { fees: true, schedule: true, enquiries: true },
};

describe("Owner Home brief composition", () => {
  it("renders the approved hierarchy, whole rupees and no detached quick actions", () => {
    render(<OwnerBriefHome initialView={VIEW} sport="pool" />);

    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Choose date.*21 November/ })).toBeTruthy();
    expect(screen.getByText("Last 7 days")).toBeTruthy();
    expect(screen.getByTestId("owner-brief-money").querySelector(".brief-major")?.textContent).toBe("₹2,700");
    expect(screen.getByText("₹98,500")).toBeTruthy();
    expect(screen.getByText("₹21,000")).toBeTruthy();
    expect(screen.getByText("3 invoices")).toBeTruthy();
    expect(screen.queryByText("New enquiry")).toBeNull();
    expect(screen.queryByText("Sessions today")).toBeNull();
    expect(screen.queryByText("Need attention")).toBeNull();
  });

  it("opens the last seven days and changes only dated collections and agenda", async () => {
    vi.mocked(getScheduleGridAction).mockResolvedValue([{
      id: "session-15", sessionDate: "2026-11-15", startsAt: "2026-11-15T11:30:00Z",
      endsAt: "2026-11-15T12:30:00Z", status: "completed", batchId: "batch-15",
      batchName: "Sunday tennis", capacity: 10, enrolled: 8, locationId: null,
      locationName: "Worli Main", coachName: "Coach Riya",
    }]);
    render(<OwnerBriefHome initialView={VIEW} sport="pool" />);

    expect(screen.queryByRole("group", { name: "Last seven days" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Choose date/ }));
    const strip = screen.getByRole("group", { name: "Last seven days" });
    const choices = within(strip).getAllByRole("button");
    expect(choices).toHaveLength(7);
    expect(choices[0].getAttribute("aria-label")).toMatch(/15 November/);
    expect(choices.at(-1)?.getAttribute("aria-label")).toMatch(/21 November/);
    fireEvent.click(choices[0]);

    expect(await screen.findByText("Sunday tennis")).toBeTruthy();
    expect(getScheduleGridAction).toHaveBeenCalledWith({ fromDate: "2026-11-15", toDate: "2026-11-15" });
    expect(screen.queryByRole("group", { name: "Last seven days" })).toBeNull();
    expect(screen.getByTestId("owner-brief-money").querySelector(".brief-major")?.textContent).toBe("₹7,900");
    expect(screen.getByText("₹98,500")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View payments" }).getAttribute("href")).toContain("from=2026-11-15&to=2026-11-16");
  });

  it("puts the cash review action before the neutral overdue link", () => {
    render(<OwnerBriefHome initialView={VIEW} sport="pool" />);
    const cash = screen.getByRole("link", { name: /Review cash count/ });
    const overdue = screen.getByRole("link", { name: /Review overdue invoices/ });
    expect(
      cash.compareDocumentPosition(overdue) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens the scope picker only from authorized facilities and keeps the enquiry workflow", () => {
    render(<OwnerBriefHome initialView={VIEW} sport="pool" />);
    expect(screen.getByRole("button", { name: /Facility scope, All facilities/ })).toBeTruthy();
    expect(screen.getAllByText("Worli Main").length).toBeGreaterThan(0);
    expect(screen.getByText("Worli Annexe")).toBeTruthy();
    expect(screen.getByRole("link", { name: /2 overdue enquiry follow-ups/ }).getAttribute("href")).toBe(
      "/owner/enquiries/e1",
    );
    expect(screen.getByRole("button", { name: /View collections/i })).toBeTruthy();
  });
});
