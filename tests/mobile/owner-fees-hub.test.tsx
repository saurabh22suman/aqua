// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.stubGlobal("crypto", { randomUUID });

// U-02 — the Fees hub tabs and invoice/dues lists. The invoice list
// is a client island over the existing InvoiceExpanded collect flow;
// actions are mocked so the render test stays a render test.

const listHubInvoicesAction = vi.fn();
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
vi.mock("@/lib/actions/payment-intents", () => ({
  listPaymentRecoveryAction: vi.fn(async () => ({
    open: null,
    lastCommitted: null,
  })),
  cancelPaymentRecoveryAction: vi.fn(async () => ({
    ok: true,
    intentId: "intent-1",
    replayed: false,
  })),
  listReversalRecoveryAction: vi.fn(async () => ({
    open: null,
    lastCommitted: null,
  })),
  cancelReversalRecoveryAction: vi.fn(async () => ({
    ok: true,
    intentId: "intent-1",
    replayed: false,
  })),
}));
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound,
}));

// Plans-page guard — the page must refuse a caller without
// settings.manage before rendering the management forms. The actions
// already refuse mutations; this pins the page-level gate.
const ownerCtx = vi.hoisted(() => ({
  value: { permissions: new Set<string>() },
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ownerCtx.value,
  requirePagePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) notFound();
    return ctx;
  },
}));
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (ctx: { permissions: Set<string> }, key: string) =>
    ctx.permissions.has(key),
}));
vi.mock("@/lib/actions/membership-plans", () => ({
  listPlanTemplatesAction: vi.fn(async () => []),
  listPlansAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/activities", () => ({
  listActivitiesAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: vi.fn(async () => []),
}));
vi.mock("@/components/plan-manager", () => ({ PlanManager: () => null }));

import { FEES_TABS, FeesTabs } from "@/components/fees/fees-tabs";
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import PlansPage from "@/app/(owner)/owner/settings/plans/page";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";

const PERIOD = { from: "2026-09-01", to: "2026-10-01" };

const DUE: HubInvoiceRow = {
  id: "11111111-1111-1111-1111-111111111111",
  invoiceNumber: "2026-0001",
  memberId: "22222222-2222-2222-2222-222222222222",
  memberName: "Ananya Sharma",
  totalPaise: 250_000,
  paidPaise: 0,
  outstandingPaise: 250_000,
  status: "issued",
  source: "membership",
  issuedOn: "2026-09-01",
  dueOn: "2026-09-10",
  locationName: "Worli",
};

afterEach(() => {
  cleanup();
  listHubInvoicesAction.mockReset();
});

describe("U-02 fees hub tabs", () => {
  it("renders Overview / Transactions / Dues / Invoices / Plans and nothing about discounts", () => {
    render(<FeesTabs active="overview" period={PERIOD} canManageSettings />);
    for (const label of ["Overview", "Transactions", "Dues", "Invoices", "Plans"]) {
      expect(
        Array.from(document.querySelectorAll("a")).some(
          (a) => a.textContent === label,
        ),
        `missing tab ${label}`,
      ).toBe(true);
    }
    expect(FEES_TABS.map((t) => t.key)).toEqual([
      "overview",
      "transactions",
      "dues",
      "invoices",
      "plans",
    ]);
  });

  it("hides the Plans tab from a caller without settings.manage", () => {
    render(<FeesTabs active="overview" period={PERIOD} />);
    for (const label of ["Overview", "Transactions", "Dues", "Invoices"]) {
      expect(
        Array.from(document.querySelectorAll("a")).some(
          (a) => a.textContent === label,
        ),
        `missing tab ${label}`,
      ).toBe(true);
    }
    expect(
      Array.from(document.querySelectorAll("a")).some(
        (a) => a.textContent === "Plans",
      ),
    ).toBe(false);
  });
});

describe("plans page guard (settings.manage)", () => {
  it("404s for a caller without settings.manage", async () => {
    ownerCtx.value = { permissions: new Set<string>() };
    await expect(PlansPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders for a settings.manage holder", async () => {
    ownerCtx.value = { permissions: new Set(["settings.manage"]) };
    await expect(PlansPage()).resolves.toBeTruthy();
  });
});

describe("U-02 dues list", () => {
  it("renders a collectible pending invoice with member, number and outstanding amount", async () => {
    listHubInvoicesAction.mockResolvedValue([DUE]);
    const { findByText } = render(
      <FeesInvoiceList
        initial={[DUE]}
        filter="dues"
        canWrite
        canRecord
        canRefund
        canReadPayments
      />,
    );
    expect(await findByText("Ananya Sharma")).toBeTruthy();
    expect(document.body.textContent).toContain("2026-0001");
    expect(document.body.textContent).toContain("outstanding");
    expect(document.body.textContent).toContain("Open");
  });

  it("says so when nothing is outstanding", () => {
    listHubInvoicesAction.mockResolvedValue([]);
    render(
      <FeesInvoiceList
        initial={[]}
        filter="dues"
        canWrite
        canRecord={false}
        canRefund={false}
        canReadPayments={false}
      />,
    );
    expect(document.body.textContent).toMatch(/nothing outstanding/i);
  });
});
