// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/facility-billing", () => ({ saveSiteBillingSettingAction: vi.fn(), resetSiteBillingSettingAction: vi.fn(), createBillingRegistrationAction: vi.fn(), saveClubBillingDefaultAction: vi.fn() }));
import { FacilityBillingForm } from "@/components/settings/facility-billing-form";
import { FacilityClubBillingForm } from "@/components/settings/facility-club-billing-form";
import { GST_STATE_NAMES } from "@/lib/gst";
afterEach(cleanup);
function expectPredictableStates(select: HTMLElement) {
  const options = Array.from(select.querySelectorAll("option")).filter((option) => option.value);
  const labels = options.map((option) => option.textContent);
  expect(labels).toEqual([...labels].sort((a, b) => a!.localeCompare(b!, "en-IN")));
  expect(options).toHaveLength(Object.keys(GST_STATE_NAMES).length);
  for (const option of options) expect(option.textContent).toBe(GST_STATE_NAMES[option.value]);
  expect(options.find((option) => option.value === "29")?.textContent).toBe("Karnataka");
}
it("lists site billing states alphabetically while retaining their GST codes", () => {
  render(<FacilityBillingForm initial={{ locationId: "11111111-1111-4111-8111-111111111111", locationName: "North site", enabled: false, stateCode: null, choice: { mode: "inherit" }, effectiveIssuer: null, registrations: [] }} club={{ legalName: "Club", legalAddress: null, stateCode: "27", gstin: null }} />);
  expectPredictableStates(screen.getByLabelText(/facility billing state/i));
});
it("uses the same predictable order for the club default", () => {
  render(<FacilityClubBillingForm initial={{ legalName: null, legalAddress: null, stateCode: null, gstin: null }} />);
  expectPredictableStates(screen.getByLabelText("Billing state"));
});
