// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CollectionsPage from "@/app/(owner)/owner/reports/collections/page";

const { locationA, locationB, read } = vi.hoisted(() => ({
  locationA: { id: "11111111-1111-4111-8111-111111111111", name: "Worli" },
  locationB: { id: "22222222-2222-4222-8222-222222222222", name: "Andheri" },
  read: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({ roleKey: "owner", permissions: new Set(["reports.financial"]), features: new Set(["reports"]) }),
  requirePagePermission: vi.fn(),
}));
vi.mock("@/db/tenant", () => ({
  withTenant: (_tenant: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("@/lib/services/people", () => ({ listLocations: async () => [locationA, locationB] }));
vi.mock("@/lib/services/location-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/services/location-access")>(),
  resolveLocationAccess: async () => ({ unrestricted: true }),
}));
vi.mock("@/lib/services/tenant-timezone", () => ({ tenantTimezoneInTx: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ overrides: {}, locale: "en" }) }));
vi.mock("@/lib/actions/reconciliation", () => ({
  getDailyCollectionAction: read,
  confirmCashCountAction: vi.fn(),
  reopenCashCountAction: vi.fn(),
}));

afterEach(() => { cleanup(); read.mockReset(); });

it("loads the linked variance date and site on the first read", async () => {
  read.mockImplementation(() => new Promise(() => {}));
  render(await CollectionsPage({ searchParams: Promise.resolve({ date: "2026-11-20", facility: locationB.id }) }));
  expect(screen.getByRole("button", { name: /collection date and facility/i }).textContent).toMatch(/20 Nov 2026.*Andheri/);
  await waitFor(() => expect(read).toHaveBeenCalledExactlyOnceWith({ onDate: "2026-11-20", locationId: locationB.id }));
});

it("offers recovery for an unavailable facility without reading collections", async () => {
  render(await CollectionsPage({ searchParams: Promise.resolve({ date: "2026-11-20", facility: "33333333-3333-4333-8333-333333333333" }) }));
  expect(screen.getByRole("heading", { name: "Facility unavailable" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "View available facilities" }).getAttribute("href")).toContain("facility=all");
  expect(read).not.toHaveBeenCalled();
});

it("offers recovery for an invalid calendar date without reading collections", async () => {
  render(await CollectionsPage({ searchParams: Promise.resolve({ date: "2026-11-31", facility: locationA.id }) }));
  expect(screen.getByRole("heading", { name: "Date unavailable" })).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
});
