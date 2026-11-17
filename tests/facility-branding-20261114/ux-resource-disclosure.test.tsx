// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
const mocks = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/lib/actions/activities", () => ({ addSubUnitAction: mocks.add, createActivityAction: vi.fn(), deleteActivityAction: vi.fn(), removeSubUnitAction: vi.fn(), updateActivityAction: vi.fn() }));
import { ActivityManager } from "@/components/activity-manager";

afterEach(cleanup);
it("shows a resource summary without twenty repeated sub-unit inputs, then opens one named editor", () => {
  const activities = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, locationId: "site", locationName: "Main", name: `Pool ${i}`, kind: "pool" as const, capacity: 10, isSample: false, subUnits: [], createdAt: "2026-11-14T00:00:00Z" }));
  render(<ActivityManager locations={[{ id: "site", name: "Main" }]} activities={activities} />);
  const first = screen.getByRole("textbox", { name: "Add sub-unit to Pool 0", hidden: true }).closest("details");
  const second = screen.getByRole("textbox", { name: "Add sub-unit to Pool 1", hidden: true }).closest("details");
  expect(first?.open).toBe(false);
  expect(second?.open).toBe(false);
  fireEvent.click(screen.getByText("Add sub-unit to Pool 0"));
  expect(first?.open).toBe(true);
  expect(second?.open).toBe(false);
});
it("keeps a named destructive resource action inside a closed edit disclosure", () => {
  render(<ActivityManager locations={[{ id: "site", name: "Main" }]} activities={[{ id: "r", locationId: "site", locationName: "Main", name: "Pool", kind: "pool", capacity: 10, isSample: false, subUnits: [], createdAt: "2026-11-14T00:00:00Z" }]} />);
  const action = screen.getByRole("button", { name: /delete/i, hidden: true });
  expect(action.closest("details")?.open).toBe(false);
  expect(action.getAttribute("aria-label")).toBe("Delete Pool");
});
it("keeps a sub-unit name after a definite refusal", async () => {
  mocks.add.mockResolvedValue({ ok: false, error: "Name already exists" });
  render(<ActivityManager locations={[{ id: "site", name: "Main" }]} activities={[{ id: "r", locationId: "site", locationName: "Main", name: "Pool", kind: "pool", capacity: 10, isSample: false, subUnits: [], createdAt: "2026-11-14T00:00:00Z" }]} />);
  fireEvent.click(screen.getByText("Add sub-unit to Pool"));
  const input = screen.getByRole("textbox", { name: "Add sub-unit to Pool" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Lane A" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByText("Name already exists");
  expect(input.value).toBe("Lane A");
});
it("keeps the sub-unit editor stable while the save is pending", async () => {
  let resolve!: (result: { ok: false; error: string }) => void;
  mocks.add.mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<ActivityManager locations={[{ id: "site", name: "Main" }]} activities={[{ id: "r", locationId: "site", locationName: "Main", name: "Pool", kind: "pool", capacity: 10, isSample: false, subUnits: [], createdAt: "2026-11-14T00:00:00Z" }]} />);
  fireEvent.click(screen.getByText("Add sub-unit to Pool"));
  const input = screen.getByRole("textbox", { name: "Add sub-unit to Pool" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Lane A" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(input.disabled).toBe(true);
  resolve({ ok: false, error: "Try again" });
  await screen.findByText("Try again");
  expect(input.disabled).toBe(false);
  expect(input.value).toBe("Lane A");
});
