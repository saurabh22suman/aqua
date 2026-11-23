// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/actions/platform-tenants", () => ({ createTenantAction: vi.fn() }));
import { NewTenantForm } from "@/app/(platform)/ops/tenants/new/new-tenant-form";

it("distinguishes a business account from its first club without changing submitted names", () => {
  render(<NewTenantForm defaultTimezone="Asia/Kolkata" defaultCurrency="INR" defaultLocationName="Main" plans={[]} defaultPlanKey="" presets={[]} defaultPresetKey="" />);
  expect(screen.getByLabelText(/business account name/i).getAttribute("name")).toBe("name");
  expect(screen.getByLabelText(/first club name/i).getAttribute("name")).toBe("locationName");
  expect(screen.getByText(/business account.*club.*activit/i)).toBeDefined();
});
