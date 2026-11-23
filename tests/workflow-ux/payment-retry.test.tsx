// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PaymentRecordForm } from "@/components/payment-record-form";

const mocks = vi.hoisted(() => ({ members: vi.fn(), invoices: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction: mocks.members }));
vi.mock("@/lib/actions/invoices", () => ({ listMemberInvoicesAction: mocks.invoices }));
vi.mock("@/components/reception/payment-record-recovery-form", () => ({
  PaymentRecordRecoveryForm: () => <p>Recording controls</p>,
}));

it("retries a failed invoice read for the same member without requiring another search", async () => {
  mocks.members.mockResolvedValue([{ memberId: "m1", fullName: "Mira Patel", memberCode: "A1", locationName: "Worli" }]);
  mocks.invoices.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ id: "inv-1", invoiceNumber: "INV-1", status: "issued", outstandingPaise: 10000, dueOn: "2026-11-14" }]);
  render(<PaymentRecordForm />);
  const input = screen.getByTestId("payment-member-search");
  fireEvent.change(input, { target: { value: "A1" } });
  fireEvent.submit(input.closest("form")!);
  fireEvent.click(await screen.findByTestId("payment-member-m1"));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not load invoices");
  expect(screen.queryByText("Loading invoices…")).toBeNull();
  expect(screen.queryByText("Recording controls")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry invoice lookup" }));
  expect(await screen.findByText("Recording controls")).toBeTruthy();
  expect(mocks.members).toHaveBeenCalledTimes(1);
  expect(mocks.invoices.mock.calls).toEqual([["m1"], ["m1"]]);
});
