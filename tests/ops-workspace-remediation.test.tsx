// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TenantTabNav } from "@/app/(platform)/ops/tenants/[tenantId]/tenant-tab-nav";
import { PlatformVerifyForm } from "@/app/(platform)/ops/verify/verify-form";
import { NewTenantForm } from "@/app/(platform)/ops/tenants/new/new-tenant-form";

vi.mock("next/navigation", () => ({
  usePathname: () => "/ops/tenants/example/locations",
}));
vi.mock("@/lib/actions/platform-auth", () => ({
  verifyPlatformTotpAction: vi.fn(),
}));
vi.mock("@/lib/actions/platform-tenants", () => ({
  createTenantAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("waits for an explicit Verify activation when a complete code is entered", () => {
  const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
  render(<PlatformVerifyForm />);

  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });

  expect(requestSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Verify" }).getAttribute("type")).toBe("submit");
});

it("groups tenant setup and investigation separately and identifies the active route", () => {
  render(<TenantTabNav tenantId="example" canViewDiagnostics />);
  const nav = screen.getByRole("navigation", { name: "Tenant" });

  const setup = within(nav).getByRole("group", { name: "Setup" });
  expect(within(setup).getByRole("link", { name: "Locations" }).getAttribute("aria-current")).toBe("page");
  const investigation = within(nav).getByRole("group", { name: "Investigation" });
  expect(within(investigation).getByRole("link", { name: "Messaging" }).getAttribute("href")).toBe("/ops/tenants/example/messaging");
});

it("shows the destination and chosen plan before provisioning a business", () => {
  render(<NewTenantForm
    defaultTimezone="Asia/Kolkata" defaultCurrency="INR" defaultLocationName="Main Club"
    plans={[{key: "basic", name: "Basic", isDefault: true}, {key: "pro", name: "Pro", isDefault: false}]}
    defaultPlanKey="basic" presets={[{key: "football", name: "Football", description: ""}]} defaultPresetKey="football"
  />);
  fireEvent.change(screen.getByRole("textbox", { name: "Business account name" }), { target: { value: "Harbour Football" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Plan" }), { target: { value: "pro" } });

  const review = screen.getByRole("region", { name: "Review business setup" });
  expect(within(review).getByText("Harbour Football")).toBeDefined();
  expect(within(review).getByText("Main Club")).toBeDefined();
  expect(within(review).getByText("Pro")).toBeDefined();
  expect(within(review).getByText("Football")).toBeDefined();
});

it("keeps the administrator-only diagnostics entry out of a viewer's workspace", () => {
  render(<TenantTabNav tenantId="example" canViewDiagnostics={false} />);
  const nav = screen.getByRole("navigation", { name: "Tenant" });

  expect(within(nav).queryByRole("link", { name: "Diagnostics" })).toBeNull();
  expect(within(nav).getByRole("link", { name: "Messaging" })).toBeDefined();
});
