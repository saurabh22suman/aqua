// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayInZone } from "@/lib/time/tz";

// PR1-C3 — the counter raise flow must not resubmit a duplicate:
// once a live invoice exists for the selected subscription and due
// date, the button is disabled and the hint names the situation.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const listMemberInvoicesAction = vi.fn();
const createInvoiceAction = vi.fn();
vi.mock("@/lib/actions/invoices", () => ({
  listMemberInvoicesAction: (...args: unknown[]) =>
    listMemberInvoicesAction(...args),
  createInvoiceAction: (...args: unknown[]) => createInvoiceAction(...args),
}));

const listMemberSubscriptionsAction = vi.fn();
vi.mock("@/lib/actions/subscriptions", () => ({
  listMemberSubscriptionsAction: (...args: unknown[]) =>
    listMemberSubscriptionsAction(...args),
}));

vi.mock("@/components/member-detail/invoice-expanded", () => ({
  InvoiceExpanded: () => null,
}));

import { MemberInvoicesPanel } from "@/components/member-detail/member-invoices-panel";

const TZ = "Asia/Kolkata";
const TODAY = todayInZone(TZ);

const SUBSCRIPTION = {
  id: "sub-1",
  memberId: "member-1",
  planId: "plan-1",
  planName: "Monthly",
  planKind: "duration",
  amountPaise: 250000,
  locationId: "loc-1",
  locationName: "Main",
  activityId: null,
  activityName: null,
  startsOn: "2026-09-01",
  endsOn: "2026-10-20",
  status: "active",
  pausedFrom: null,
  pausedUntil: null,
  autoRenew: false,
  createdAt: "2026-09-01T00:00:00.000Z",
};

function invoiceRow(dueOn: string, status = "issued") {
  return {
    id: "inv-1",
    invoiceNumber: "INV/2026-27/0001",
    financialYear: "2026-27",
    documentKind: "tax_invoice",
    issuedOn: dueOn,
    dueOn,
    subtotalPaise: 250000,
    taxPaise: 45000,
    totalPaise: 295000,
    paidPaise: 0,
    outstandingPaise: 295000,
    status,
    source: "membership",
    gstin: null,
    locationId: "loc-1",
    locationName: "Main",
    subscriptionId: "sub-1",
    activityName: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemberInvoicesPanel duplicate guard (PR1-C3)", () => {
  it("disables Raise invoice when a live invoice for today already exists", async () => {
    listMemberSubscriptionsAction.mockResolvedValue([SUBSCRIPTION]);
    listMemberInvoicesAction.mockResolvedValue([invoiceRow(TODAY)]);

    render(
      <MemberInvoicesPanel
        memberId="member-1"
        canWrite
        canRecord
        timezone={TZ}
      />,
    );

    const button = await screen.findByRole("button", { name: "Raise invoice" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toMatch(/already exists/i);
  });

  it("shows the friendly error when the server refuses a race", async () => {
    listMemberSubscriptionsAction.mockResolvedValue([SUBSCRIPTION]);
    listMemberInvoicesAction.mockResolvedValue([]);
    createInvoiceAction.mockResolvedValue({
      ok: false,
      error: "An invoice for this due date was just raised. Refresh to see it.",
    });

    render(
      <MemberInvoicesPanel
        memberId="member-1"
        canWrite
        canRecord
        timezone={TZ}
      />,
    );

    const button = await screen.findByRole("button", { name: "Raise invoice" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);

    await screen.findByText(/just raised/i);
    expect(document.body.textContent).not.toMatch(/23505|_uidx/);
  });
});
