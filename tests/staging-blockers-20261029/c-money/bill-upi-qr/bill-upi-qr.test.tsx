// @vitest-environment jsdom
//
// Bill-linked UPI QR acceptance. The QR is a payment REQUEST: it must
// encode the same amount the operator is about to record, never mutate
// money, and disappear immediately when the amount/account changes.
// These are rendered tests against the real payment surfaces.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.stubGlobal("crypto", { randomUUID });

const getInvoiceAction = vi.fn();
const voidInvoiceAction = vi.fn();
const listMemberInvoicesAction = vi.fn();
vi.mock("@/lib/actions/invoices", () => ({
  getInvoiceAction: (...args: unknown[]) => getInvoiceAction(...args),
  voidInvoiceAction: (...args: unknown[]) => voidInvoiceAction(...args),
  listMemberInvoicesAction: (...args: unknown[]) =>
    listMemberInvoicesAction(...args),
}));

const listInvoicePaymentsAction = vi.fn();
const recordPaymentAction = vi.fn();
vi.mock("@/lib/actions/payments", () => ({
  listInvoicePaymentsAction: (...args: unknown[]) =>
    listInvoicePaymentsAction(...args),
  recordPaymentAction: (...args: unknown[]) => recordPaymentAction(...args),
}));

const listPaymentReversalsAction = vi.fn();
const reversePaymentAction = vi.fn();
vi.mock("@/lib/actions/payment-reversals", () => ({
  listPaymentReversalsAction: (...args: unknown[]) =>
    listPaymentReversalsAction(...args),
  reversePaymentAction: (...args: unknown[]) => reversePaymentAction(...args),
}));

const listPaymentRecoveryAction = vi.fn();
const cancelPaymentRecoveryAction = vi.fn();
const listReversalRecoveryAction = vi.fn();
const cancelReversalRecoveryAction = vi.fn();
vi.mock("@/lib/actions/payment-intents", () => ({
  listPaymentRecoveryAction: (...args: unknown[]) =>
    listPaymentRecoveryAction(...args),
  cancelPaymentRecoveryAction: (...args: unknown[]) =>
    cancelPaymentRecoveryAction(...args),
  listReversalRecoveryAction: (...args: unknown[]) =>
    listReversalRecoveryAction(...args),
  cancelReversalRecoveryAction: (...args: unknown[]) =>
    cancelReversalRecoveryAction(...args),
}));

const listPaymentQrsAction = vi.fn();
vi.mock("@/lib/actions/payment-qrs", () => ({
  listPaymentQrsAction: (...args: unknown[]) => listPaymentQrsAction(...args),
}));

const toStringMock = vi.fn();
vi.mock("qrcode", () => ({
  toString: (...args: unknown[]) => toStringMock(...args),
}));

import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";
import { PaymentRecordRecoveryForm } from "@/components/reception/payment-record-recovery-form";
import { CafeBillPanel } from "@/components/cafe-bill-panel";
import { BillUpiQr } from "@/components/payments/bill-upi-qr";
import type { InvoiceDetail, InvoiceRow } from "@/lib/services/invoices";
import type { PaymentQrRow } from "@/lib/services/payment-qrs";
import type { CafeBill } from "@/lib/services/cafe-billing";

const EMPTY = { open: null, lastCommitted: null };
const OPEN = {
  intentId: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
  createdAt: "2026-10-29T10:05:00.000Z",
};

const UPI_QR: PaymentQrRow = {
  id: "qr-upi-1",
  nickname: "Counter UPI",
  kind: "upi",
  upiId: "club@okhdfcbank",
  payeeName: "Sharma Sports",
  imageMime: null,
  hasImage: false,
  isActive: true,
  sortOrder: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
};

const UPI_QR_TWO: PaymentQrRow = {
  ...UPI_QR,
  id: "qr-upi-2",
  nickname: "Second UPI",
  upiId: "second@okicici",
  payeeName: "Sharma Sports Second",
  sortOrder: 1,
};

const IMAGE_QR: PaymentQrRow = {
  ...UPI_QR,
  id: "qr-image",
  nickname: "Uploaded QR",
  kind: "image",
  upiId: null,
  payeeName: null,
  imageMime: "image/png",
  hasImage: true,
};

const OWNER_INVOICE: InvoiceDetail = {
  id: "inv-1",
  invoiceNumber: "INV/2026-27/0001",
  financialYear: "2026-27",
  documentKind: "bill_of_supply",
  issuedOn: "2026-09-01",
  dueOn: "2026-09-10",
  subtotalPaise: 250000,
  taxPaise: 0,
  totalPaise: 250000,
  paidPaise: 100000,
  outstandingPaise: 150000,
  status: "partial",
  source: "membership",
  gstin: null,
  locationId: "loc-1",
  locationName: "Main",
  subscriptionId: "sub-1",
  activityName: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  memberId: "member-1",
  memberName: "Audit Child",
  lines: [],
};

const RECEPTION_INVOICE: InvoiceRow = {
  ...OWNER_INVOICE,
  id: "inv-r",
  invoiceNumber: "INV-R-0001",
};

const BILL: CafeBill = {
  orderId: "o1",
  status: "billed",
  memberId: "m1",
  memberName: "Aadhya Sharma",
  locationId: "11111111-1111-7111-8111-111111111111",
  locationName: "Worli",
  documentKind: "tax_invoice",
  invoiceId: "inv-cafe",
  invoiceNumber: "INV-2026-0001",
  invoiceStatus: "issued",
  lines: [],
  subtotalPaise: 25000,
  taxPaise: 1250,
  totalPaise: 26250,
  amountDuePaise: 26250,
};

const RECORDED = {
  ok: true,
  id: "pay-1",
  invoiceStatus: "paid",
  replayed: false,
};

function resetMocks() {
  getInvoiceAction.mockResolvedValue(OWNER_INVOICE);
  listInvoicePaymentsAction.mockResolvedValue([]);
  listPaymentReversalsAction.mockResolvedValue([]);
  listPaymentRecoveryAction.mockResolvedValue(EMPTY);
  listReversalRecoveryAction.mockResolvedValue(EMPTY);
  cancelPaymentRecoveryAction.mockResolvedValue({
    ok: true,
    intentId: OPEN.intentId,
    replayed: false,
  });
  cancelReversalRecoveryAction.mockResolvedValue({
    ok: true,
    intentId: OPEN.intentId,
    replayed: false,
  });
  listPaymentQrsAction.mockResolvedValue([UPI_QR]);
  recordPaymentAction.mockResolvedValue(RECORDED);
  toStringMock.mockResolvedValue('<svg data-testid="bill-qr-svg"></svg>');
}

beforeEach(resetMocks);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderOwner() {
  render(
    <InvoiceExpanded
      invoiceId="inv-1"
      canWrite
      canRecord
      canRefund
      canReadPayments
      onChanged={() => {}}
    />,
  );
  await screen.findByRole("button", { name: /record payment/i });
  fireEvent.change(screen.getByLabelText("Method"), {
    target: { value: "upi" },
  });
  return screen.findByRole("button", { name: /show upi qr/i });
}

async function renderReception() {
  render(
    <PaymentRecordRecoveryForm
      invoice={RECEPTION_INVOICE}
      onRecorded={async () => null}
    />,
  );
  await screen.findByRole("button", { name: /record payment/i });
  fireEvent.click(screen.getByRole("radio", { name: /upi/i }));
  return screen.findByRole("button", { name: /show upi qr/i });
}

async function showQr(button: HTMLElement) {
  fireEvent.click(button);
  await waitFor(() => expect(toStringMock).toHaveBeenCalled());
  return toStringMock.mock.calls.at(-1)?.[0] as string;
}

describe("bill-linked UPI QR — owner invoice", () => {
  it("encodes the exact current amount and payee, and never mutates money", async () => {
    const show = await renderOwner();
    const uri = await showQr(show);

    expect(uri).toContain("pa=club@okhdfcbank");
    expect(uri).toContain("pn=Sharma%20Sports");
    expect(uri).toContain("am=1500.00");
    expect(screen.getByTestId("bill-qr-svg")).toBeTruthy();
    expect(screen.getByText(/Sharma Sports/)).toBeTruthy();
    expect(screen.getByText(/club@okhdfcbank/)).toBeTruthy();
    expect(screen.getByTestId("bill-upi-amount").textContent).toMatch(/₹1,500.00/);
    expect(screen.getByTestId("bill-upi-invoice").textContent).toMatch(/INV\/2026-27\/0001/);

    expect(recordPaymentAction).not.toHaveBeenCalled();
    expect(reversePaymentAction).not.toHaveBeenCalled();
    expect(cancelPaymentRecoveryAction).not.toHaveBeenCalled();
    expect(cancelReversalRecoveryAction).not.toHaveBeenCalled();
  });

  it("updates the encoded amount and removes the old QR immediately when the amount changes", async () => {
    const show = await renderOwner();
    await showQr(show);
    expect(await screen.findByTestId("bill-qr-svg")).toBeTruthy();

    // The next encode stays pending: the previous scannable QR must not
    // remain beside the new amount while the new one is generated.
    toStringMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.change(screen.getByLabelText(/amount/i), {
      target: { value: "1000" },
    });

    expect(screen.queryByTestId("bill-qr-svg")).toBeNull();
    expect(screen.getByTestId("link-qr-loading")).toBeTruthy();
    await waitFor(() =>
      expect(toStringMock).toHaveBeenLastCalledWith(
        expect.stringContaining("am=1000.00"),
        expect.anything(),
      ),
    );
  });

  it("removes the old QR immediately when the receiving account changes", async () => {
    listPaymentQrsAction.mockResolvedValue([UPI_QR, UPI_QR_TWO]);
    const show = await renderOwner();
    await showQr(show);
    expect(await screen.findByTestId("bill-qr-svg")).toBeTruthy();

    toStringMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.change(screen.getByTestId("bill-upi-account"), {
      target: { value: UPI_QR_TWO.id },
    });

    expect(screen.queryByTestId("bill-qr-svg")).toBeNull();
    expect(screen.getByTestId("link-qr-loading")).toBeTruthy();
    await waitFor(() =>
      expect(toStringMock).toHaveBeenLastCalledWith(
        expect.stringContaining("pa=second@okicici"),
        expect.anything(),
      ),
    );
  });

  it("clears the open QR when the invoice changes", async () => {
    listPaymentQrsAction.mockResolvedValue([UPI_QR]);
    toStringMock.mockResolvedValue('<svg data-testid="invoice-qr"></svg>');
    const { rerender } = render(
      <BillUpiQr
        invoiceId="inv-1"
        invoiceNumber="INV-1"
        amountPaise={150000n}
        outstandingPaise={150000n}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show upi qr/i }));
    await waitFor(() => expect(screen.getByTestId("invoice-qr")).toBeTruthy());

    rerender(
      <BillUpiQr
        invoiceId="inv-2"
        invoiceNumber="INV-2"
        amountPaise={150000n}
        outstandingPaise={150000n}
      />,
    );

    expect(screen.queryByTestId("invoice-qr")).toBeNull();
    expect(screen.queryByTestId("bill-upi-open")).toBeNull();
    expect(screen.getByRole("button", { name: /show upi qr/i })).toBeTruthy();
  });

  it("clears the open QR and unknown-outcome state when the mounted form switches invoice", async () => {
    getInvoiceAction.mockImplementation(async (id: unknown) =>
      id === "inv-2"
        ? {
            ...OWNER_INVOICE,
            id: "inv-2",
            invoiceNumber: "INV/2026-27/0002",
          }
        : OWNER_INVOICE,
    );
    let resolveOldQr: ((svg: string) => void) | undefined;
    toStringMock.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveOldQr = resolve;
      }),
    );
    recordPaymentAction.mockRejectedValueOnce(new Error("Failed to fetch"));

    const { rerender } = render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );
    await screen.findByRole("button", { name: /record payment/i });
    fireEvent.change(screen.getByLabelText("Method"), {
      target: { value: "upi" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /show upi qr/i }));
    await waitFor(() => expect(toStringMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/reference/i), {
      target: { value: "UTR-OLD" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    expect(await screen.findByText(/outcome is unknown/i)).toBeTruthy();

    rerender(
      <InvoiceExpanded
        invoiceId="inv-2"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByText(/INV\/2026-27\/0002/)).toBeTruthy();
    expect(screen.queryByText(/outcome is unknown/i)).toBeNull();
    expect(screen.queryByTestId("bill-upi-open")).toBeNull();
    expect(screen.getByRole("button", { name: /show upi qr/i })).toBeTruthy();

    // An encoder response started for the old bill must not surface under
    // the new bill even when the amount/payee URL is otherwise identical.
    resolveOldQr!('<svg data-testid="old-invoice-qr"></svg>');
    await waitFor(() =>
      expect(screen.queryByTestId("old-invoice-qr")).toBeNull(),
    );
  });

  it("ignores a late account-list response from the previous bill", async () => {
    let resolveA: ((rows: PaymentQrRow[]) => void) | undefined;
    let resolveB: ((rows: PaymentQrRow[]) => void) | undefined;
    listPaymentQrsAction
      .mockImplementationOnce(
        () =>
          new Promise<PaymentQrRow[]>((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<PaymentQrRow[]>((resolve) => {
            resolveB = resolve;
          }),
      );
    toStringMock.mockResolvedValue('<svg data-testid="account-race-qr"></svg>');

    const { rerender } = render(
      <BillUpiQr
        invoiceId="inv-a"
        invoiceNumber="INV-A"
        amountPaise={150000n}
        outstandingPaise={150000n}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show upi qr/i }));
    await waitFor(() => expect(listPaymentQrsAction).toHaveBeenCalledTimes(1));

    rerender(
      <BillUpiQr
        invoiceId="inv-b"
        invoiceNumber="INV-B"
        amountPaise={150000n}
        outstandingPaise={150000n}
      />,
    );
    const showB = await screen.findByRole("button", { name: /show upi qr/i });
    expect((showB as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(showB);
    await waitFor(() => expect(listPaymentQrsAction).toHaveBeenCalledTimes(2));

    resolveB!([UPI_QR_TWO]);
    expect(await screen.findByText(/second@okicici/)).toBeTruthy();
    resolveA!([UPI_QR]);

    await waitFor(() =>
      expect(screen.queryByText(/club@okhdfcbank/)).toBeNull(),
    );
    expect(screen.getByText(/second@okicici/)).toBeTruthy();
  });

  it("manual recording after showing the QR keeps the existing UPI payload and recovery key", async () => {
    const show = await renderOwner();
    await showQr(show);
    fireEvent.change(screen.getByLabelText(/reference/i), {
      target: { value: "UTR-9001" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    await waitFor(() => expect(recordPaymentAction).toHaveBeenCalledTimes(1));
    expect(recordPaymentAction).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      amountPaise: 150000,
      method: "upi",
      reference: "UTR-9001",
      idempotencyKey: expect.any(String),
      observedIntentId: null,
    });
  });

  it("blocks a new QR while the recording request is in flight", async () => {
    await renderOwner();
    recordPaymentAction.mockReturnValue(new Promise(() => {}));
    fireEvent.change(screen.getByLabelText(/reference/i), {
      target: { value: "UTR-IN-FLIGHT" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(
      await screen.findByText(/Recording is in progress/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show upi qr/i })).toBeNull();
  });

  it("blocks a new QR after a thrown recording even when the re-read is empty", async () => {
    await renderOwner();
    recordPaymentAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    fireEvent.change(screen.getByLabelText(/reference/i), {
      target: { value: "UTR-UNKNOWN" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(await screen.findByText(/did not complete/i)).toBeTruthy();
    expect(
      await screen.findByText(/outcome is unknown/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show upi qr/i })).toBeNull();
  });
});

describe("bill-linked UPI QR — reception and café", () => {
  it("renders the bill amount in the reception form", async () => {
    const show = await renderReception();
    const uri = await showQr(show);
    expect(uri).toContain("am=1500.00");
    expect(uri).toContain("pa=club@okhdfcbank");
    expect(recordPaymentAction).not.toHaveBeenCalled();
  });

  it("renders the full café bill amount with no second amount field", async () => {
    listPaymentQrsAction.mockResolvedValue([UPI_QR]);
    render(<CafeBillPanel bill={BILL} onPaid={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /upi qr/i }));
    const show = await screen.findByRole("button", { name: /show upi qr/i });
    const uri = await showQr(show);
    expect(uri).toContain("am=262.50");
    expect(uri).toContain("pa=club@okhdfcbank");
    expect(screen.queryByTestId("payment-amount")).toBeNull();
    expect(screen.queryByTestId("cafe-amount")).toBeNull();
    expect(recordPaymentAction).not.toHaveBeenCalled();
  });

  it("blocks the reception QR after a thrown recording with an empty re-read", async () => {
    await renderReception();
    recordPaymentAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    fireEvent.change(screen.getByLabelText(/upi reference/i), {
      target: { value: "UTR-UNKNOWN" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(await screen.findByText(/did not complete/i)).toBeTruthy();
    expect(
      await screen.findByText(/outcome is unknown/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show upi qr/i })).toBeNull();
  });

  it("blocks the café QR while its recording request is in flight", async () => {
    listPaymentQrsAction.mockResolvedValue([UPI_QR]);
    render(<CafeBillPanel bill={BILL} onPaid={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /upi qr/i }));
    await screen.findByRole("button", { name: /show upi qr/i });
    fireEvent.change(screen.getByTestId("cafe-reference"), {
      target: { value: "UTR-IN-FLIGHT" },
    });
    recordPaymentAction.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(
      await screen.findByText(/Recording is in progress/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show upi qr/i })).toBeNull();
  });
});

describe("bill-linked UPI QR — truthful unavailable states", () => {
  it("explains no active UPI account and keeps manual payment available", async () => {
    listPaymentQrsAction.mockResolvedValue([]);
    const show = await renderOwner();
    fireEvent.click(show);
    expect(await screen.findByText(/No active UPI account/i)).toBeTruthy();
    expect(screen.queryByTestId("bill-qr-svg")).toBeNull();
    expect(screen.queryByTestId("link-qr")).toBeNull();
    expect(screen.getByRole("button", { name: /record payment/i })).toBeTruthy();
  });

  it("explains a denied/failed QR read without broadening access", async () => {
    listPaymentQrsAction.mockRejectedValue(new Error("Missing permission"));
    const show = await renderOwner();
    fireEvent.click(show);
    expect(
      await screen.findByText(/Could not load a UPI account/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("bill-qr-svg")).toBeNull();
    expect(screen.getByRole("button", { name: /record payment/i })).toBeTruthy();
  });

  it("never claims an uploaded image QR embeds the bill amount", async () => {
    listPaymentQrsAction.mockResolvedValue([IMAGE_QR]);
    const show = await renderOwner();
    fireEvent.click(show);
    expect(
      await screen.findByText(/Only image QRs are configured/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("bill-qr-svg")).toBeNull();
    expect(screen.getByLabelText(/amount/i)).toBeTruthy();
  });

  it("shows a truthful encoder failure and no QR", async () => {
    toStringMock.mockRejectedValue(new Error("encode failed"));
    const show = await renderOwner();
    fireEvent.click(show);
    expect(await screen.findByText(/Could not create the UPI QR/i)).toBeTruthy();
    expect(screen.queryByTestId("bill-qr-svg")).toBeNull();
  });
});

describe("bill-linked UPI QR — invalid and recovery states", () => {
  it.each([
    ["invalid", "abc"],
    ["zero", "0"],
    ["over-outstanding", "2000"],
  ])("does not offer a QR for an %s amount", async (_label, value) => {
    const show = await renderOwner();
    fireEvent.change(screen.getByLabelText(/amount/i), {
      target: { value },
    });
    expect((show as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(/Enter an amount within the outstanding balance/i),
    ).toBeTruthy();
    fireEvent.click(show);
    expect(toStringMock).not.toHaveBeenCalled();
  });

  it("does not offer a QR on a paid invoice", async () => {
    getInvoiceAction.mockResolvedValue({
      ...OWNER_INVOICE,
      status: "paid",
      outstandingPaise: 0,
      paidPaise: 250000,
    });
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );
    expect(await screen.findByText("Paid")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show upi qr/i })).toBeNull();
  });

  it("blocks a QR while an earlier attempt is open", async () => {
    listPaymentRecoveryAction.mockResolvedValue({
      open: OPEN,
      lastCommitted: null,
    });
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );
    await screen.findByRole("button", { name: /discard unfinished attempt/i });
    fireEvent.change(screen.getByLabelText("Method"), {
      target: { value: "upi" },
    });
    expect(
      await screen.findByText(/Resolve the earlier attempt/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show upi qr/i })).toBeNull();
  });

  it("blocks a QR while the chain is ambiguous", async () => {
    listPaymentRecoveryAction.mockResolvedValue({
      open: null,
      lastCommitted: null,
      ambiguous: true,
    });
    render(
      <InvoiceExpanded
        invoiceId="inv-1"
        canWrite
        canRecord
        canRefund
        canReadPayments
        onChanged={() => {}}
      />,
    );
    await screen.findByTestId("payment-recovery-ambiguous");
    fireEvent.change(screen.getByLabelText("Method"), {
      target: { value: "upi" },
    });
    expect(
      await screen.findByText(/Resolve the earlier attempt/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show upi qr/i })).toBeNull();
  });
});
