import { describe, expect, it, vi } from "vitest";

// PR1-C5 — booking pricing has no admin UI, so the reception booking
// screen is a dead end ("No price is configured for this slot").
// Until V-05/V-06 ship, the route is hidden: no reception path may
// reach it. The tile removal is pinned in
// tests/mobile/reception-today-page.test.tsx; this pins the route.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireReception: async () => ({ permissions: new Set() }),
}));
vi.mock("@/lib/actions/bookings", () => ({
  listBookableFacilitiesAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: vi.fn(async () => ({ locale: "en", overrides: {} })),
}));
vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: vi.fn(async () => "Asia/Kolkata"),
}));

import ReceptionBookingsPage from "@/app/(reception)/reception/bookings/page";

describe("Reception bookings route hidden (PR1-C5)", () => {
  it("refuses to render the dead-end booking screen", async () => {
    await expect(ReceptionBookingsPage()).rejects.toThrow(
      /NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });
});
