import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => {} }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "0190c000-0000-7000-8000-000000000001" }), requirePagePermission: () => {} }));
vi.mock("@/lib/actions/branding", () => ({ getBrandingAction: async () => ({ displayName: "Example", shortName: "E", accent: "mango" }) }));
vi.mock("@/components/branding/branding-form", () => ({ BrandingForm: () => <p>Brand form</p> }));
import BrandingSettingsPage from "@/app/(owner)/owner/settings/branding/page";
it("offers an explicit tenant-bound staff install entry", async () => {
  const html = renderToStaticMarkup(await BrandingSettingsPage());
  expect(html).toContain('/clubs/0190c000-0000-7000-8000-000000000001/install?source=staff');
});
