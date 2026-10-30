// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.stubGlobal("crypto", { randomUUID });

// Owner redesign · People lane (C2) — the invoice collection context.
//
// RED target (branch feat/owner-redesign-people-c2, base d1425e7):
//
//   1. The expanded invoice printed the raw database state ("issued")
//      in a hand-rolled chip instead of the shared status pill with a
//      readable word.
//   2. The record-payment form used hand-rolled controls at the old
//      44px metric, with the label as a <span> inside a wrapping
//      <label>, so the collection decision did not use the shared
//      controls the rest of the owner surface uses.
//   3. The correction (void) reason field was the same hand-rolled
//      control.
//
// The context itself — the total, what is paid and what is still
// outstanding — was already beside the collection form, and the guard
// test below keeps it there.

vi.mock("@/lib/actions/invoices", () => ({
  getInvoiceAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
}));
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: vi.fn(async () => []),
  recordPaymentAction: vi.fn(),
}));
vi.mock("@/lib/actions/payment-reversals", () => ({
  listPaymentReversalsAction: vi.fn(async () => []),
  reversePaymentAction: vi.fn(),
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

vi.mock("@/lib/actions/payment-qrs", () => ({
  listPaymentQrsAction: vi.fn(async () => []),
}));

import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";
import { getInvoiceAction } from "@/lib/actions/invoices";
import type { InvoiceDetail } from "@/lib/services/invoices";

const DETAIL = {
  id: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  financialYear: "2026-27",
  documentKind: "Bill of Supply",
  issuedOn: "2026-10-01",
  dueOn: "2026-10-10",
  subtotalPaise: 250000,
  taxPaise: 0,
  totalPaise: 250000,
  paidPaise: 0,
  outstandingPaise: 250000,
  status: "issued",
  source: "membership",
  gstin: null,
  locationName: "Worli Main",
  activityName: null,
  memberId: "m1",
  memberName: "Aaradhya Iyer",
  lines: [
    {
      id: "l1",
      description: "Monthly Swim membership",
      sacCode: "9999",
      amountPaise: 250000,
      taxPaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
    },
  ],
} as unknown as InvoiceDetail;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("invoice collection context (C2)", () => {
  it("states the invoice state as a readable word", async () => {
    vi.mocked(getInvoiceAction).mockResolvedValue(DETAIL);
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund={false}
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText("Issued")).toBeTruthy());
    expect(screen.queryByText("issued")).toBeNull();
  });

  it("keeps the invoice context beside the collection decision", async () => {
    vi.mocked(getInvoiceAction).mockResolvedValue(DETAIL);
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund={false}
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText("Issued")).toBeTruthy());
    const text = document.body.textContent ?? "";
    // The total, what is paid and what is outstanding stay readable…
    expect(text).toMatch(/outstanding/i);
    expect(text).toMatch(/₹2,500/);
    // …and the collection decision is on the same panel.
    expect(screen.getByRole("button", { name: /record payment/i })).toBeTruthy();
  });

  it("labels the collection controls with the shared field shape", async () => {
    vi.mocked(getInvoiceAction).mockResolvedValue(DETAIL);
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund={false}
        canReadPayments
        onChanged={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText("Issued")).toBeTruthy());

    const controls = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, select, textarea",
      ),
    );
    const unlabelled = controls.filter((control) => {
      if (control.labels && control.labels.length) {
        const text = Array.from(control.labels)
          .map((label) => (label.textContent ?? "").trim())
          .join(" ")
          .trim();
        if (text.length) return false;
      }
      const aria = control.getAttribute("aria-label");
      return !(aria && aria.trim().length);
    });
    expect(unlabelled.map((control) => control.outerHTML.slice(0, 80))).toEqual([]);
  });
});
