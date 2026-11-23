// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/platform-preset-apply", () => ({ applyPresetAction: vi.fn() }));
vi.mock("@/lib/actions/platform-tenants", () => ({ createTenantAction: vi.fn() }));
import { PresetDetailForm } from "@/app/(platform)/ops/presets/[key]/preset-detail-form";
import { NewTenantForm } from "@/app/(platform)/ops/tenants/new/new-tenant-form";
afterEach(cleanup);
const tenant = (id: string) => ({ id, name: id, slug: id, status: "active", presetKey: null, presetVersion: null });
const location = (id: string) => ({ id, name: id, kind: "pool", isPrimary: true, presetKey: null, presetVersion: null, eligible: true });
it("reconciles the chosen tenant and location when search results change", () => {
  const { rerender, container } = render(<PresetDetailForm presetKey="swim" presetName="Swim" tenants={[tenant("one")]} locationsByTenant={{ one: [location("first")] }} />);
  rerender(<PresetDetailForm presetKey="swim" presetName="Swim" tenants={[tenant("two")]} locationsByTenant={{ two: [location("second")] }} />);
  expect((screen.getByTestId("ops-preset-tenant-select") as HTMLSelectElement).value).toBe("two");
  expect((container.querySelector('input[name="locationId"]') as HTMLInputElement).value).toBe("second");
  expect(screen.queryByText(/no live location/i)).toBeNull();
});
it("updates the provisioning hierarchy from the typed names", () => {
  render(<NewTenantForm defaultTimezone="Asia/Kolkata" defaultCurrency="INR" defaultLocationName="Main" plans={[]} defaultPlanKey="" presets={[]} defaultPresetKey="" />);
  fireEvent.change(screen.getByLabelText(/business account name/i), { target: { value: "Ocean Business" } });
  fireEvent.change(screen.getByLabelText(/first club name/i), { target: { value: "Bay Club" } });
  const review = within(screen.getByRole("region", { name: "Review business setup" }));
  expect(review.getByText("Ocean Business")).toBeDefined();
  expect(review.getByText("Bay Club")).toBeDefined();
});
