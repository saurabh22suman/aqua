// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: vi.fn() }));
vi.mock("@/lib/actions/activities", () => ({ listActivitiesAction: async () => [] }));
vi.mock("@/lib/actions/booking-price-admin", () => ({ listBookingPriceRulesAction: async () => [] }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/components/bookings/booking-price-rule-form", () => ({ BookingPriceRuleForm: () => null }));
vi.mock("@/components/bookings/booking-price-rule-list", () => ({ BookingPriceRuleList: () => null }));
import BookingPricesPage from "@/app/(owner)/owner/settings/booking-prices/page";
afterEach(cleanup);
it("states the quoted-price safeguard once and keeps the booking desk path", async () => {
  const { container } = render(await BookingPricesPage());
  const text = container.textContent ?? "";
  expect((text.match(/price it was quoted|retain their quoted\s*price/gi) ?? [])).toHaveLength(1);
  expect(screen.getByText(/unpriced slot is refused/i)).toBeTruthy();
  expect(screen.getByRole("link", {name:/open booking desk/i}).getAttribute("href")).toBe("/owner/bookings");
});
