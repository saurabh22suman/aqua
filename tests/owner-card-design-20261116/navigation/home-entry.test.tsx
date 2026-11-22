// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ permissions: new Set<string>(), features: new Set<string>(), allowFacility: false }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => state }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));
vi.mock("@/lib/actions/dashboard", () => ({ getOwnerDashboardAction: vi.fn(() => { throw new Error("dashboard read not allowed"); }) }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: async () => state.allowFacility }));
import OwnerHomePage from "@/app/(owner)/owner/page";

afterEach(() => { cleanup(); state.allowFacility = false; });
it("sends a limited operational reader to schedule before programs", async () => {
  state.permissions = new Set(["programs.read", "attendance.read"]);
  state.features = new Set(["programs", "attendance"]);
  await expect(OwnerHomePage({ searchParams: Promise.resolve({ facility: "all" }) })).rejects.toThrow("REDIRECT:/owner/schedule?facility=all");
});
it("keeps financial entry for an entitled accountant", async () => {
  state.permissions = new Set(["reports.financial", "invoices.read"]);
  state.features = new Set(["reports", "billing"]);
  await expect(OwnerHomePage({ searchParams: Promise.resolve({ facility: "all" }) })).rejects.toThrow("REDIRECT:/owner/fees?facility=all");
});
it("allows a programs-only reader to enter the catalogue", async () => {
  state.permissions = new Set(["programs.read"]);
  state.features = new Set(["programs"]);
  await expect(OwnerHomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/owner/programs");
});
it("preserves an authorized selected facility for the schedule", async () => {
  state.permissions = new Set(["attendance.read"]);
  state.features = new Set(["attendance"]);
  state.allowFacility = true;
  await expect(OwnerHomePage({ searchParams: Promise.resolve({ facility: "11111111-1111-4111-8111-111111111111" }) })).rejects.toThrow("REDIRECT:/owner/schedule?facility=11111111-1111-4111-8111-111111111111");
});
it("sends an attendance-only user to schedule with all-facility scope", async () => {
  state.permissions = new Set(["attendance.read"]);
  state.features = new Set();
  await expect(OwnerHomePage({ searchParams: Promise.resolve({ facility: "all" }) })).rejects.toThrow("REDIRECT:/owner/schedule?facility=all");
});
it("sends a finance-only user to the default Fees overview without members or invoice grants", async () => {
  state.permissions = new Set(["reports.financial", "programs.read"]);
  state.features = new Set(["reports", "billing"]);
  await expect(OwnerHomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/owner/fees");
});
it("validates and preserves explicit facility for the accountant fallback", async () => {
  state.permissions = new Set(["reports.financial", "invoices.read"]);
  state.features = new Set(["reports", "billing"]);
  const facility = "11111111-1111-4111-8111-111111111111";
  render(await OwnerHomePage({ searchParams: Promise.resolve({ facility }) }));
  expect(screen.getByRole("heading", { name: "Facility unavailable" })).toBeTruthy();
  cleanup();
  state.allowFacility = true;
  await expect(OwnerHomePage({ searchParams: Promise.resolve({ facility }) })).rejects.toThrow(`REDIRECT:/owner/fees?facility=${facility}`);
});
it("does not send a user without permitted destinations to Fees", async () => {
  state.permissions = new Set();
  state.features = new Set();
  render(await OwnerHomePage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("heading", { name: "No workspace access" })).toBeTruthy();
});
it("does not route into financial reports when billing is not entitled", async () => {
  state.permissions = new Set(["reports.financial"]);
  state.features = new Set(["reports"]);
  render(await OwnerHomePage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("heading", { name: "No workspace access" })).toBeTruthy();
});
it.each([["billing", ["reports"]], ["reports", ["billing"]]] as const)("does not route to Fees without its %s entitlement", async (_missing, features) => {
  state.permissions = new Set(["reports.financial", "members.read"]);
  state.features = new Set(features);
  await expect(OwnerHomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/owner/members");
});
it("refuses malformed or unauthorized explicit facility before redirecting", async () => {
  state.permissions = new Set(["members.read"]);
  state.features = new Set(["members"]);
  render(await OwnerHomePage({ searchParams: Promise.resolve({ facility: "bad" }) }));
  expect(screen.getByRole("heading", { name: "Facility unavailable" })).toBeTruthy();
  cleanup();
  render(await OwnerHomePage({ searchParams: Promise.resolve({ facility: "11111111-1111-4111-8111-111111111111" }) }));
  expect(screen.getByRole("heading", { name: "Facility unavailable" })).toBeTruthy();
});
