// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PaymentRecordForm } from "@/components/payment-record-form";

const mocks = vi.hoisted(() => ({ search: vi.fn(), invoices: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction: mocks.search }));
vi.mock("@/lib/actions/invoices", () => ({ listMemberInvoicesAction: mocks.invoices }));
vi.mock("@/lib/actions/payments", () => ({ recordPaymentAction: vi.fn() }));
vi.mock("@/lib/actions/payment-intents", () => ({
  listPaymentRecoveryAction: vi.fn(),
  cancelPaymentRecoveryAction: vi.fn(),
}));
const anika = { memberId: "anika", fullName: "Anika Joshi", memberCode: "J-01", locationName: "Worli Main" };

afterEach(() => { cleanup(); vi.resetAllMocks(); });

function edit(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Find member" }), { target: { value } });
}

it("audit priority clears a selectable result when the typed payer query changes", async () => {
  mocks.search.mockResolvedValueOnce([anika]).mockRejectedValueOnce(new Error("offline"));
  render(<PaymentRecordForm />);
  edit("Anika");
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByRole("button", { name: /Anika Joshi/ });
  edit("Rohan");
  expect(screen.queryByRole("button", { name: /Anika Joshi/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not search/i);
  expect(screen.queryByRole("button", { name: /Anika Joshi/ })).toBeNull();
  expect(mocks.invoices).not.toHaveBeenCalled();
});

it("audit priority ignores a search response that arrives after the clerk changes the query", async () => {
  let deliver!: (rows: typeof anika[]) => void;
  mocks.search.mockReturnValueOnce(new Promise<typeof anika[]>(resolve => { deliver = resolve; }));
  render(<PaymentRecordForm />);
  edit("Anika");
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  edit("Rohan");
  await act(async () => deliver([anika]));
  expect(screen.queryByRole("button", { name: /Anika Joshi/ })).toBeNull();
  expect(screen.queryByText(/member[s]? found/i)).toBeNull();
});
