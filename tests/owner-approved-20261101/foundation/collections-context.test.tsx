// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ read: vi.fn(), confirm: vi.fn(), reopen: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/actions/reconciliation", () => ({ getDailyCollectionAction: api.read, confirmCashCountAction: api.confirm, reopenCashCountAction: api.reopen }));
vi.mock("@/components/facility-navigation", () => ({ navigateFacility: api.navigate }));
import { CollectionsReport } from "@/components/reports/collections-report";
import { CollectionsTrends } from "@/components/reports/owner-approved/collections-trends";
import type { MethodTotal, OwnerChartsData } from "@/lib/services/owner-home-charts";

const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222", c = "33333333-3333-4333-8333-333333333333";
const locations = [{ id: a, name: "Worli" }, { id: b, name: "Andheri" }];
const base = { defaultDate: "2026-10-09", locations, facilityLabel: "Facility", canConfirm: true, canReopen: false, showNavigation: true };
beforeEach(() => { vi.clearAllMocks(); api.read.mockResolvedValue({ onDate: "2026-10-09", totalPaise: 120000, paymentCount: 2, cashPaise: 100000, cafePaise: 0, cafeOrders: 0, byMethod: [], byStaff: [], cashCount: null }); });
afterEach(cleanup);

it("initializes the selected permitted facility instead of the first facility", async () => {
  render(<CollectionsReport {...base} initialLocationId={b} />);
  await waitFor(() => expect(api.read).toHaveBeenCalledWith({ onDate: "2026-10-09", locationId: b }));
  expect((screen.getByRole("combobox", { name: "Facility" }) as HTMLSelectElement).value).toBe(b);
});

it("does not query or substitute a different facility when the selection is unavailable", async () => {
  render(<CollectionsReport {...base} initialLocationId={c} />);
  expect(screen.getByRole("alert").textContent).toMatch(/choose.*facility/i);
  expect(api.read).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Facility" }), { target: { value: b } });
  await waitFor(() => expect(api.read).toHaveBeenCalledWith({ onDate: "2026-10-09", locationId: b }));
});

it("warns before leaving a cash draft and follows the live selected site", async () => {
  render(<CollectionsReport {...base} initialLocationId={b} />);
  await screen.findByRole("button", { name: /confirm count/i });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1200" } });
  fireEvent.click(screen.getByRole("link", { name: "Trends" }));
  expect(screen.getByRole("dialog").textContent).toMatch(/unsaved/i);
  expect(api.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /leave/i }));
  expect(api.navigate).toHaveBeenCalledWith(expect.stringContaining(`facility=${b}`));
});

it("uses stable method colors regardless of which methods are nonzero", () => {
  const method = (key: "cash" | "upi" | "other", paise: number): MethodTotal => ({ key, label: key.toUpperCase(), group: key === "upi" ? "digital" : key, paise, count: 1, pct: 50 });
  const data = { period: { key: "last7", currentFromDate: "2026-10-01", currentToDate: "2026-10-01" }, collections: { totalPaise: 100, paymentCount: 1, reversedPaise: 0, reversalCount: 0, buckets: [], methods: [method("upi", 100), method("other", 100)] } } as unknown as OwnerChartsData;
  const view = render(<CollectionsTrends data={data} />);
  const color = (label: string) => screen.getByText(`${label}: 100`, { selector: "title" }).parentElement?.getAttribute("class");
  const upi = color("UPI"), other = color("OTHER");
  expect(upi).toContain("--chart-2"); expect(other).toContain("--chart-3");
  expect(screen.getAllByText(/UPI ·/)[0].closest("li")!.querySelector("span")?.className).toContain("--chart-2");
  expect(screen.getAllByText(/OTHER ·/)[0].closest("li")!.querySelector("span")?.className).toContain("--chart-3");
  view.rerender(<CollectionsTrends data={{ ...data, collections: { ...data.collections, methods: [method("cash", 100), method("upi", 100), method("other", 100)] } }} />);
  expect(color("UPI")).toBe(upi);
  expect(color("OTHER")).toBe(other);
});

it("prevents navigation while a cash confirmation is pending", async () => {
  api.confirm.mockReturnValue(new Promise(() => {}));
  render(<CollectionsReport {...base} initialLocationId={b} />);
  await screen.findByRole("button", { name: /confirm count/i });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));
  fireEvent.click(screen.getByRole("link", { name: "Trends" }));
  expect(api.navigate).not.toHaveBeenCalled();
  expect(screen.getAllByRole("status").some(node => /wait.*request/i.test(node.textContent ?? ""))).toBe(true);
});

it.each(["Trends", "All reports"])("does not warn of an unsaved draft after successful confirmation when opening %s", async name => {
  api.confirm.mockResolvedValue({ ok: true, variancePaise: 0, systemPaise: 100000, needsReview: false });
  render(<CollectionsReport {...base} initialLocationId={b} />);
  await screen.findByRole("button", { name: /confirm count/i });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1000" } });
  fireEvent.change(screen.getByPlaceholderText("Optional note"), { target: { value: "Counted" } });
  fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));
  await screen.findByText(/counted and matched/i);
  await waitFor(() => expect(screen.getByRole("button", { name: /confirm count/i }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("link", { name }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(api.navigate).toHaveBeenCalledOnce();
});

it.each(["rejected", "uncertain"])("protects the draft after %s confirmation", async outcome => {
  if (outcome === "rejected") api.confirm.mockResolvedValue({ ok: false, error: "Not saved" });
  else api.confirm.mockRejectedValue(new Error("lost response"));
  render(<CollectionsReport {...base} initialLocationId={b} />);
  await screen.findByRole("button", { name: /confirm count/i });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));
  await screen.findByText(outcome === "rejected" ? /not saved/i : /request did not complete/i);
  await waitFor(() => expect(screen.getByRole("button", { name: /confirm count/i }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("link", { name: "Trends" }));
  expect(screen.getByRole("dialog").textContent).toMatch(/unsaved/i);
  expect(api.navigate).not.toHaveBeenCalled();
});

it("keeps edits made while confirmation is pending as a genuine draft", async () => {
  let finish!: (result: { ok: true; variancePaise: number; systemPaise: number; needsReview: boolean }) => void;
  api.confirm.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<CollectionsReport {...base} initialLocationId={b} />);
  await screen.findByRole("button", { name: /confirm count/i });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1001" } });
  await act(async () => finish({ ok: true, variancePaise: 0, systemPaise: 100000, needsReview: false }));
  fireEvent.click(screen.getByRole("link", { name: "Trends" }));
  expect(screen.getByRole("dialog").textContent).toMatch(/unsaved/i);
  expect(api.navigate).not.toHaveBeenCalled();
});

it("keeps the cash draft when staying and uses the live local facility on the Reports link", async () => {
  render(<CollectionsReport {...base} initialLocationId={a} />);
  await screen.findByRole("button", { name: /confirm count/i });
  fireEvent.change(screen.getByRole("combobox", { name: "Facility" }), { target: { value: b } });
  await waitFor(() => expect(api.read).toHaveBeenCalledWith({ onDate: "2026-10-09", locationId: b }));
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1200" } });
  fireEvent.click(screen.getByRole("link", { name: "All reports" }));
  fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  expect((screen.getByPlaceholderText("0.00") as HTMLInputElement).value).toBe("1200");
  expect(api.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "All reports" }));
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  expect(api.navigate).toHaveBeenCalledWith(`/owner/reports?facility=${b}`);
});

it("protects a note-only draft", async () => {
  render(<CollectionsReport {...base} initialLocationId={b} />);
  await screen.findByRole("button", { name: /confirm count/i });
  fireEvent.change(screen.getByPlaceholderText("Optional note"), { target: { value: "Review later" } });
  fireEvent.click(screen.getByRole("link", { name: "Trends" }));
  expect(screen.getByRole("dialog").textContent).toMatch(/unsaved/i);
  expect(api.navigate).not.toHaveBeenCalled();
});

it("protects an open reopen draft", async () => {
  api.read.mockResolvedValueOnce({ onDate: "2026-10-09", totalPaise: 100000, paymentCount: 1, cashPaise: 100000, cafePaise: 0, cafeOrders: 0, byMethod: [], byStaff: [], cashCount: { countedPaise: 100000, systemPaise: 100000, variancePaise: 0, note: null, confirmedByName: "Owner", confirmedAt: "2026-10-09T12:00:00Z", needsReview: false } });
  render(<CollectionsReport {...base} initialLocationId={b} canReopen />);
  fireEvent.click(await screen.findByRole("button", { name: "Reopen" }));
  fireEvent.change(screen.getByPlaceholderText("Reason for reopening"), { target: { value: "Recount" } });
  fireEvent.click(screen.getByRole("link", { name: "Trends" }));
  expect(screen.getByRole("dialog").textContent).toMatch(/unsaved/i);
  expect(api.navigate).not.toHaveBeenCalled();
});
