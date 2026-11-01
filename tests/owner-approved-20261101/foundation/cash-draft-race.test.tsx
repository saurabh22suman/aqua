// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ read: vi.fn(), confirm: vi.fn(), reopen: vi.fn() }));
vi.mock("@/lib/actions/reconciliation", () => ({ getDailyCollectionAction: api.read, confirmCashCountAction: api.confirm, reopenCashCountAction: api.reopen }));
import { CollectionsReport } from "@/components/reports/collections-report";

const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
const locations = [{ id: a, name: "First" }, { id: b, name: "Second" }];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function count(value: string) { fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value } }); }
function note(value: string) { fireEvent.change(screen.getByPlaceholderText("Optional note"), { target: { value } }); }
function values() { return [(screen.getByPlaceholderText("0.00") as HTMLInputElement).value, (screen.getByPlaceholderText("Optional note") as HTMLInputElement).value]; }
beforeEach(() => { vi.clearAllMocks(); api.read.mockResolvedValue({ onDate: "2026-10-09", totalPaise: 100000, paymentCount: 1, cashPaise: 100000, cafePaise: 0, cafeOrders: 0, byMethod: [], byStaff: [], cashCount: null }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("preserves an identical new draft at another site when the old confirmation succeeds", async () => {
  const pending = deferred<{ ok: true; variancePaise: number }>(); api.confirm.mockReturnValue(pending.promise);
  render(<CollectionsReport defaultDate="2026-10-09" locations={locations} facilityLabel="Facility" canConfirm canReopen={false} />);
  await screen.findByRole("button", { name: /confirm count/i }); count("1000"); note("same note");
  fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));
  expect(api.confirm).toHaveBeenCalledWith({ locationId: a, onDate: "2026-10-09", countedPaise: 100000, note: "same note" });
  fireEvent.change(screen.getByRole("combobox", { name: "Facility" }), { target: { value: b } });
  await waitFor(() => expect(api.read).toHaveBeenCalledWith({ onDate: "2026-10-09", locationId: b }));
  await screen.findByPlaceholderText("0.00"); count("1000"); note("same note");
  await act(async () => { pending.resolve({ ok: true, variancePaise: 0 }); await pending.promise; });
  expect(values()).toEqual(["1000", "same note"]);
  expect(api.read).toHaveBeenLastCalledWith({ onDate: "2026-10-09", locationId: b });
});

it("preserves a same-site draft edited away and back to the submitted values", async () => {
  const pending = deferred<{ ok: true; variancePaise: number }>(); api.confirm.mockReturnValue(pending.promise);
  render(<CollectionsReport defaultDate="2026-10-09" locations={locations} facilityLabel="Facility" canConfirm canReopen={false} />);
  await screen.findByRole("button", { name: /confirm count/i }); count("1000"); note("same note");
  fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));
  count("1001"); count("1000"); note("changed"); note("same note");
  await act(async () => { pending.resolve({ ok: true, variancePaise: 0 }); await pending.promise; });
  expect(values()).toEqual(["1000", "same note"]);
});

it("clears the submitted draft after success when no newer edit occurred", async () => {
  const pending = deferred<{ ok: true; variancePaise: number }>(); api.confirm.mockReturnValue(pending.promise);
  render(<CollectionsReport defaultDate="2026-10-09" locations={locations} facilityLabel="Facility" canConfirm canReopen={false} />);
  await screen.findByRole("button", { name: /confirm count/i }); count("1000"); note("same note");
  fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));
  await act(async () => { pending.resolve({ ok: true, variancePaise: 0 }); await pending.promise; });
  expect(values()).toEqual(["", ""]);
});

it("retains the original draft when confirmation is refused", async () => {
  const pending = deferred<{ ok: false; error: string }>(); api.confirm.mockReturnValue(pending.promise);
  render(<CollectionsReport defaultDate="2026-10-09" locations={locations} facilityLabel="Facility" canConfirm canReopen={false} />);
  await screen.findByRole("button", { name: /confirm count/i }); count("1000"); note("same note");
  fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));
  await act(async () => { pending.resolve({ ok: false, error: "Refused" }); await pending.promise; });
  expect(values()).toEqual(["1000", "same note"]);
  expect(screen.getByRole("status").textContent).toContain("Refused");
});
