// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — the dues/invoices list must keep
// the facility scope the server rendered with, and an older response
// must never replace a newer scope's rows.

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
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";

const FACILITY_A = "11111111-1111-4111-8111-111111111111";
const FACILITY_B = "22222222-2222-4222-8222-222222222222";

function invoice(overrides: Partial<HubInvoiceRow>): HubInvoiceRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    invoiceNumber: "2026-0001",
    memberId: "44444444-4444-4444-8444-444444444444",
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

const ROW_A = invoice({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", memberName: "Worli Member", locationName: "Worli" });
const ROW_B = invoice({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", memberName: "Andheri Member", locationName: "Andheri" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  listHubInvoicesAction.mockReset();
});

describe("FeesInvoiceList facility scope (P1)", () => {
  it("reloads with the displayed facility instead of widening to every location", async () => {
    listHubInvoicesAction.mockResolvedValue([ROW_A]);
    const { rerender } = render(
      <FeesInvoiceList
        initial={[ROW_A]}
        filter="dues"
        facility={FACILITY_A}
        canWrite
        canRecord
        canRefund
        canReadPayments
      />,
    );

    // Scope change after mount (facility switcher navigation): the
    // reload must carry the new facility.
    rerender(
      <FeesInvoiceList
        initial={[ROW_B]}
        filter="dues"
        facility={FACILITY_B}
        canWrite
        canRecord
        canRefund
        canReadPayments
      />,
    );

    await waitFor(() =>
      expect(listHubInvoicesAction).toHaveBeenCalledWith({
        status: "dues",
        locationId: FACILITY_B,
      }),
    );
  });

  it("discards a late response for an earlier scope", async () => {
    const slowB = deferred<HubInvoiceRow[]>();
    const fastA = deferred<HubInvoiceRow[]>();
    listHubInvoicesAction
      .mockImplementationOnce(() => slowB.promise)
      .mockImplementationOnce(() => fastA.promise);

    const { rerender } = render(
      <FeesInvoiceList
        initial={[]}
        filter="all"
        facility={FACILITY_A}
        canWrite
        canRecord
        canRefund
        canReadPayments
      />,
    );
    // Switch to B → request 1 (B). Switch back to A → request 2 (A).
    rerender(
      <FeesInvoiceList
        initial={[]}
        filter="all"
        facility={FACILITY_B}
        canWrite
        canRecord
        canRefund
        canReadPayments
      />,
    );
    await waitFor(() => expect(listHubInvoicesAction).toHaveBeenCalledTimes(1));
    rerender(
      <FeesInvoiceList
        initial={[]}
        filter="all"
        facility={FACILITY_A}
        canWrite
        canRecord
        canRefund
        canReadPayments
      />,
    );
    await waitFor(() => expect(listHubInvoicesAction).toHaveBeenCalledTimes(2));

    // The current scope (A) resolves first…
    fastA.resolve([ROW_A]);
    await waitFor(() => expect(screen.queryByText("Worli Member")).toBeTruthy());
    // …then the superseded B response arrives and must be ignored.
    slowB.resolve([ROW_B]);
    await waitFor(() => expect(screen.queryByText("Andheri Member")).toBeNull());
    expect(screen.queryByText("Worli Member")).toBeTruthy();
  });

  it("shows a recoverable failure state instead of stale rows", async () => {
    listHubInvoicesAction.mockRejectedValue(new Error("offline"));
    const { rerender } = render(
      <FeesInvoiceList
        initial={[ROW_A]}
        filter="dues"
        facility={FACILITY_A}
        canWrite
        canRecord
        canRefund
        canReadPayments
      />,
    );
    rerender(
      <FeesInvoiceList
        initial={[ROW_B]}
        filter="dues"
        facility={FACILITY_B}
        canWrite
        canRecord
        canRefund
        canReadPayments
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/could not load this list/i)).toBeTruthy(),
    );
    expect(screen.queryByText("Worli Member")).toBeNull();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
