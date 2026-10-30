// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Staging blocker F15 — "UTC day formatting remains in IST-facing invoice
// and runway UI".
//
// The defect (source-confirmed in the 29 Oct 2026 staging review):
//
//   components/fees/fees-invoice-list.tsx
//     invoice.outstandingPaise > 0 && invoice.dueOn < new Date().toISOString().slice(0, 10)
//   components/member-subscription-panel.tsx
//     daysBetween(subscription.startsOn, new Date().toISOString().slice(0, 10)) + 1
//
// `toISOString().slice(0, 10)` is the UTC day. Between 00:00 and 05:29 IST
// the UTC day is still yesterday, so the invoice overdue flag and the plan
// used-days strip disagree with the IST-based backend dates (the backend
// resolves "today" with `todayInZone(tenant.timezone)`).
//
// RED design — every case below is a deterministic instant, not a race:
//
//   00:00 IST  = 2026-10-29T18:30:00Z   (UTC day 2026-10-29, IST 2026-10-30)
//   05:29 IST  = 2026-10-29T23:59:00Z   (UTC day 2026-10-29, IST 2026-10-30)
//   05:30 IST  = 2026-10-30T00:00:00Z   (UTC day 2026-10-30, IST 2026-10-30)
//   month edge = 2026-09-30T18:30:00Z   (UTC day 2026-09-30, IST 2026-10-01)
//
// The clock is faked for `Date` only, so React's timers and the testing
// library's waits stay real.

const listHubInvoicesAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/fees-hub", () => ({
  listHubInvoicesAction: (...args: unknown[]) => listHubInvoicesAction(...args),
}));
vi.mock("@/lib/actions/invoices", () => ({
  getInvoiceAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: vi.fn(),
  recordPaymentAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const listMemberSubscriptionsAction = vi.hoisted(() => vi.fn());
const listPlansAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/subscriptions", () => ({
  listMemberSubscriptionsAction: (...args: unknown[]) =>
    listMemberSubscriptionsAction(...args),
  createSubscriptionAction: vi.fn(),
  cancelSubscriptionAction: vi.fn(),
  pauseSubscriptionAction: vi.fn(),
  resumeSubscriptionAction: vi.fn(),
}));
vi.mock("@/lib/actions/membership-plans", () => ({
  listPlansAction: (...args: unknown[]) => listPlansAction(...args),
}));

import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import { MemberSubscriptionPanel } from "@/components/member-subscription-panel";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";
import type { SubscriptionRow } from "@/lib/services/subscriptions";

const MEMBER_ID = "44444444-4444-4444-8444-444444444444";

function invoice(overrides: Partial<HubInvoiceRow> = {}): HubInvoiceRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    invoiceNumber: "2026-0001",
    memberId: MEMBER_ID,
    memberName: "Ananya Sharma",
    totalPaise: 250_000,
    paidPaise: 0,
    outstandingPaise: 250_000,
    status: "issued",
    source: "membership",
    issuedOn: "2026-09-01",
    dueOn: "2026-09-10",
    locationName: "Worli",
    ...overrides,
  };
}

function subscription(
  overrides: Partial<SubscriptionRow> = {},
): SubscriptionRow {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    memberId: MEMBER_ID,
    planId: "66666666-6666-4666-8666-666666666666",
    planName: "Gold",
    planKind: "duration",
    amountPaise: 300_000,
    locationId: "77777777-7777-4777-8777-777777777777",
    locationName: "Worli",
    activityId: null,
    activityName: null,
    startsOn: "2026-09-01",
    endsOn: "2026-10-30",
    status: "active",
    pausedFrom: null,
    pausedUntil: null,
    autoRenew: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderInvoices(rows: HubInvoiceRow[]) {
  return render(
    <FeesInvoiceList
      initial={rows}
      filter="all"
      facility={null}
      canWrite={false}
      canRecord={false}
      canRefund={false}
      canReadPayments={false}
    />,
  );
}

function overdueBadges(): HTMLElement[] {
  return screen.queryAllByText("Overdue");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  listHubInvoicesAction.mockResolvedValue([]);
  listMemberSubscriptionsAction.mockResolvedValue([]);
  listPlansAction.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  listHubInvoicesAction.mockReset();
  listMemberSubscriptionsAction.mockReset();
  listPlansAction.mockReset();
});

describe("F15 · invoice overdue flag uses the IST day", () => {
  it("marks an invoice overdue at 00:00 IST on the day after its due date", () => {
    // 2026-10-30 00:00 IST. The UTC day is still 2026-10-29, so the
    // UTC-based comparison treats a 29 Oct due date as "not yet due".
    vi.setSystemTime(new Date("2026-10-29T18:30:00.000Z"));

    renderInvoices([invoice({ dueOn: "2026-10-29" })]);

    expect(overdueBadges()).toHaveLength(1);
  });

  it("marks an invoice overdue at 05:29 IST, while the UTC day is still yesterday", () => {
    // 2026-10-30 05:29 IST — the last instant before the UTC date catches up.
    vi.setSystemTime(new Date("2026-10-29T23:59:00.000Z"));

    renderInvoices([invoice({ dueOn: "2026-10-29" })]);

    expect(overdueBadges()).toHaveLength(1);
  });

  it("agrees with the calendar once the UTC day has caught up (05:30 IST)", () => {
    // 2026-10-30 05:30 IST — UTC and IST now name the same day, so the
    // flag must not depend on which helper is used.
    vi.setSystemTime(new Date("2026-10-30T00:00:00.000Z"));

    renderInvoices([
      invoice({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        memberName: "Past Due Member",
        dueOn: "2026-10-29",
      }),
      invoice({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        memberName: "Not Due Member",
        dueOn: "2026-10-30",
      }),
    ]);

    expect(overdueBadges()).toHaveLength(1);
    expect(
      screen.getByText("Past Due Member").closest("tr")?.textContent ?? "",
    ).toContain("Overdue");
    expect(
      screen.getByText("Not Due Member").closest("tr")?.textContent ?? "",
    ).not.toContain("Overdue");
  });

  it("crosses the month boundary on the IST day", () => {
    // 2026-10-01 00:00 IST. The UTC day is 2026-09-30, so a 30 Sep due
    // date looks current to the UTC comparison.
    vi.setSystemTime(new Date("2026-09-30T18:30:00.000Z"));

    renderInvoices([
      invoice({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        memberName: "Past Due Member",
        dueOn: "2026-09-30",
      }),
      invoice({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        memberName: "Not Due Member",
        dueOn: "2026-10-01",
      }),
    ]);

    expect(overdueBadges()).toHaveLength(1);
    expect(
      screen.getByText("Past Due Member").closest("tr")?.textContent ?? "",
    ).toContain("Overdue");
    expect(
      screen.getByText("Not Due Member").closest("tr")?.textContent ?? "",
    ).not.toContain("Overdue");
  });

  it("never marks a settled invoice overdue", () => {
    vi.setSystemTime(new Date("2026-10-29T18:30:00.000Z"));

    renderInvoices([
      invoice({ outstandingPaise: 0, paidPaise: 250_000, status: "paid", dueOn: "2026-10-29" }),
    ]);

    expect(overdueBadges()).toHaveLength(0);
  });
});

describe("F15 · subscription runway uses the IST day", () => {
  it("counts used days from the IST day, not the UTC day", async () => {
    // 2026-10-01 00:00 IST. A subscription from 1 Sep to 30 Oct has run
    // 31 of its 60 days; the UTC day (30 Sep) would report 30.
    vi.setSystemTime(new Date("2026-09-30T18:30:00.000Z"));
    listMemberSubscriptionsAction.mockResolvedValue([subscription()]);

    render(<MemberSubscriptionPanel memberId={MEMBER_ID} canManage={false} />);

    await waitFor(() =>
      expect(screen.getByTestId("runway-strip").textContent ?? "").toContain(
        "29 of 60 days left",
      ),
    );
  });

  it("clamps a subscription that starts in the future to zero used days", async () => {
    vi.setSystemTime(new Date("2026-10-29T18:30:00.000Z"));
    listMemberSubscriptionsAction.mockResolvedValue([
      subscription({ startsOn: "2026-11-01", endsOn: "2026-11-30" }),
    ]);

    render(<MemberSubscriptionPanel memberId={MEMBER_ID} canManage={false} />);

    await waitFor(() =>
      expect(screen.getByTestId("runway-strip").textContent ?? "").toContain(
        "30 of 30 days left",
      ),
    );
  });
});
