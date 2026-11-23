// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), members: vi.fn(), bill: vi.fn() }));
vi.mock("@/lib/actions/orders", () => ({ createOrderAction: mocks.create, requestCafeBillAction: mocks.bill }));
vi.mock("@/lib/actions/menu", () => ({ listMenuAction: mocks.list }));
vi.mock("@/lib/actions/payments", () => ({ recordPaymentAction: vi.fn() }));
vi.mock("@/lib/actions/payment-intents", () => ({ listPaymentRecoveryAction: vi.fn(), cancelPaymentRecoveryAction: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction: mocks.members }));
import { CafeOrderScreen } from "@/components/cafe-order-screen";

afterEach(cleanup);
it("quotes each selected site's tax and clears the cart when switching sites", () => {
  const a = "11111111-1111-7111-8111-111111111111", b = "22222222-2222-7222-8222-222222222222";
  const categories = [{ id: "ca", locationId: a, name: "Drinks", sortOrder: 0, isActive: true }, { id: "cb", locationId: b, name: "Drinks", sortOrder: 0, isActive: true }];
  const item = { pricePaise: 10000, taxRateBp: 500, sacCode: "996331", isVeg: true, isActive: true };
  render(<CafeOrderScreen categories={categories} items={[{ ...item, id: "a", locationId: a, categoryId: "ca", name: "Tea" }, { ...item, id: "b", locationId: b, categoryId: "cb", name: "Coffee" }]} locations={[{ id: a, name: "Registered" }, { id: b, name: "Unregistered" }]} terminology={{ overrides: {}, locale: "en" }} taxRegistered={true} taxRegistrationByLocation={{ [a]: true, [b]: false }} />);
  fireEvent.click(screen.getByRole("button", { name: "Add Tea" }));
  expect(screen.getByTestId("cart-total").getAttribute("data-total-paise")).toBe("10500");
  fireEvent.click(screen.getByRole("button", { name: "Unregistered" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Coffee" }));
  expect(screen.getByTestId("cart-total").getAttribute("data-total-paise")).toBe("10000");
});

it("refreshes a changed site quote before creating an order", async () => {
  const a = "11111111-1111-7111-8111-111111111111";
  const category = { id: "ca", locationId: a, name: "Drinks", sortOrder: 0, isActive: true };
  const item = { id: "a", locationId: a, categoryId: "ca", name: "Tea", pricePaise: 10000, taxRateBp: 500, sacCode: "996331", isVeg: true, isActive: true };
  mocks.create.mockReset();
  mocks.list.mockResolvedValue({ taxRegistered: false });
  render(<CafeOrderScreen categories={[category]} items={[item]} locations={[{ id: a, name: "Main" }]} terminology={{ overrides: {}, locale: "en" }} taxRegistered={true} taxRegistrationByLocation={{ [a]: true }} />);
  fireEvent.click(screen.getByRole("button", { name: "Add Tea" }));
  fireEvent.click(screen.getByRole("button", { name: "Place order" }));
  await waitFor(() => expect(screen.getByTestId("cart-total").getAttribute("data-total-paise")).toBe("10000"));
  expect(mocks.create).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function renderTwoSites() {
  const a = "11111111-1111-7111-8111-111111111111", b = "22222222-2222-7222-8222-222222222222";
  const categories = [{ id: "ca", locationId: a, name: "Drinks", sortOrder: 0, isActive: true }, { id: "cb", locationId: b, name: "Drinks", sortOrder: 0, isActive: true }];
  const common = { pricePaise: 10000, taxRateBp: 500, sacCode: "996331", isVeg: true, isActive: true };
  render(<CafeOrderScreen categories={categories} items={[{ ...common, id: "a", locationId: a, categoryId: "ca", name: "Tea" }, { ...common, id: "b", locationId: b, categoryId: "cb", name: "Coffee" }]} locations={[{ id: a, name: "Registered" }, { id: b, name: "Unregistered" }]} terminology={{ overrides: {}, locale: "en" }} taxRegistered={true} taxRegistrationByLocation={{ [a]: true, [b]: false }} />);
  fireEvent.click(screen.getByRole("button", { name: "Add Tea" }));
  return { a };
}
function expectPendingCartLocked() {
  expect(screen.getByTestId("cafe-member")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Place order" }) as HTMLButtonElement).disabled).toBe(true);
  for (const name of ["Unregistered", "Add Tea", "Increase Tea", "Decrease Tea"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(screen.getByTestId("cart-total").getAttribute("data-total-paise")).toBe("10500");
  expect(screen.queryByRole("button", { name: "Add Coffee" })).toBeNull();
}
it("locks site and cart during quote refresh and unlocks after a definite failure", async () => {
  mocks.list.mockReset(); mocks.create.mockReset();
  const pending = deferred<{ taxRegistered: boolean }>();
  mocks.list.mockReturnValue(pending.promise);
  mocks.create.mockResolvedValue({ ok: false, error: "Not saved" });
  const { a } = renderTwoSites();
  fireEvent.click(screen.getByRole("button", { name: "Place order" }));
  expectPendingCartLocked();
  await act(async () => pending.resolve({ taxRegistered: true }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expect(mocks.create).toHaveBeenCalledWith({ locationId: a, expectedTaxRegistered: true, memberId: null, lines: [{ itemId: "a", qty: 1 }] });
  await screen.findByText("Not saved");
  expect((screen.getByRole("button", { name: "Unregistered" }) as HTMLButtonElement).disabled).toBe(false);
});

it("cannot select a previously searched member while quote refresh is pending", async () => {
  mocks.list.mockReset(); mocks.create.mockReset(); mocks.members.mockReset();
  const pending = deferred<{ taxRegistered: boolean }>();
  mocks.list.mockReturnValue(pending.promise);
  mocks.create.mockResolvedValue({ ok: false, error: "Not saved" });
  mocks.members.mockResolvedValue([{ memberId: "member-1", fullName: "Member One", memberCode: "M1" }]);
  renderTwoSites();
  fireEvent.change(screen.getByTestId("cafe-member-search"), { target: { value: "Member" } });
  fireEvent.click(screen.getByRole("button", { name: "Search members" }));
  const option = await screen.findByTestId("cafe-member-option-member-1") as HTMLButtonElement;
  fireEvent.click(screen.getByRole("button", { name: "Place order" }));
  expect(option.disabled).toBe(true);
  fireEvent.click(option);
  await act(async () => pending.resolve({ taxRegistered: true }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expect(mocks.create.mock.calls[0]?.[0].memberId).toBeNull();
});
it("keeps a placed order in place while its bill request is pending", async () => {
  mocks.list.mockReset(); mocks.create.mockReset(); mocks.members.mockReset(); mocks.bill.mockReset();
  mocks.list.mockResolvedValue({ taxRegistered: true });
  mocks.create.mockResolvedValue({ ok: true, orderId: "order-1", totalPaise: 10500 });
  mocks.members.mockResolvedValue([{ memberId: "member-1", fullName: "Member One", memberCode: "M1" }]);
  const pending = deferred<{ ok: false; error: string }>();
  mocks.bill.mockReturnValue(pending.promise);
  renderTwoSites();
  fireEvent.change(screen.getByTestId("cafe-member-search"), { target: { value: "Member" } });
  fireEvent.click(screen.getByRole("button", { name: "Search members" }));
  fireEvent.click(await screen.findByTestId("cafe-member-option-member-1"));
  fireEvent.click(screen.getByRole("button", { name: "Place order" }));
  await screen.findByTestId("cafe-order-status");
  fireEvent.click(screen.getByRole("button", { name: "Request bill" }));
  await waitFor(() => expect(mocks.bill).toHaveBeenCalledTimes(1));
  const reset = screen.getByRole("button", { name: "Start a new order" }) as HTMLButtonElement;
  expect(reset.disabled).toBe(true);
  fireEvent.click(reset);
  expect(screen.getByTestId("cafe-order-status")).toBeTruthy();
  await act(async () => pending.resolve({ ok: false, error: "Bill refused" }));
  await screen.findByText("Bill refused");
  expect((screen.getByRole("button", { name: "Start a new order" }) as HTMLButtonElement).disabled).toBe(false);
});
it("locks site and cart while create is pending, prevents duplicate submission, and unlocks after failure", async () => {
  mocks.list.mockReset(); mocks.create.mockReset();
  const pending = deferred<{ ok: false; error: string }>();
  mocks.list.mockResolvedValue({ taxRegistered: true });
  mocks.create.mockReturnValue(pending.promise);
  const { a } = renderTwoSites();
  fireEvent.click(screen.getByRole("button", { name: "Place order" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expectPendingCartLocked();
  fireEvent.click(screen.getByRole("button", { name: "Place order" }));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledWith({ locationId: a, expectedTaxRegistered: true, memberId: null, lines: [{ itemId: "a", qty: 1 }] });
  await act(async () => pending.resolve({ ok: false, error: "Not saved" }));
  await screen.findByText("Not saved");
  expect((screen.getByRole("button", { name: "Increase Tea" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Increase Tea" }));
  expect(screen.getByTestId("cart-total").getAttribute("data-total-paise")).toBe("21000");
});
