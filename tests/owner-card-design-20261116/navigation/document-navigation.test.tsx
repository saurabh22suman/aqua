// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";

// Model the client router intercepting ordinary clicks, without assuming its internals.
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} onClick={(event) => event.preventDefault()} /> }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "tenant", userId: "user", roleKey: "owner", features: new Set(), permissions: new Set(["settings.manage", "settings.read"]) }), requirePagePermission: () => {} }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => {} }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => null }));
vi.mock("@/lib/services/branding", () => ({ getBranding: async () => ({ displayName: null, fallbackDisplayName: "Business" }) }));
vi.mock("@/lib/actions/locations", () => ({ listAdminLocationsAction: async () => [] }));
vi.mock("@/lib/actions/onboarding-checklist", () => ({ getOnboardingChecklistAction: async () => null }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => null }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => null }));
import { MemberDetailTabs } from "@/components/member-detail/member-detail-tabs";
import { OwnerMemberSummary } from "@/components/member-detail/owner-member-summary";
import { FeesTabs } from "@/components/fees/fees-tabs";
import { FeesOverviewCards } from "@/components/fees/fees-overview-cards";
import SettingsPage from "@/app/(owner)/owner/settings/page";

afterEach(cleanup);
function expectNative(link: HTMLElement, href: string, modified = false) {
  expect(link.getAttribute("href")).toBe(href);
  const event = createEvent.click(link, { bubbles: true, cancelable: true, ctrlKey: modified });
  let intercepted = true;
  const observe = (e: Event) => { intercepted = e.defaultPrevented; e.preventDefault(); };
  document.addEventListener("click", observe, { once: true });
  fireEvent(link, event);
  expect(intercepted).toBe(false);
}
it("uses native scoped links for member sections, more destinations and invoice summary", () => {
  render(<><MemberDetailTabs memberId="m" active="overview" facilityScope="site" accessHref="/owner/members/m/access?facility=site" /><OwnerMemberSummary status="active" plans={[]} balance="₹100" canManage={false} paymentsHref="/owner/members/m?tab=payments&facility=site" /></>);
  expectNative(screen.getByRole("link", { name: "Fees" }), "/owner/members/m?tab=payments&facility=site");
  expectNative(screen.getByRole("link", { name: "Overview" }), "/owner/members/m?tab=overview&facility=site", true);
  expectNative(screen.getByRole("link", { name: "View invoices" }), "/owner/members/m?tab=payments&facility=site");
  fireEvent.click(screen.getByText("More"));
  expectNative(screen.getByRole("link", { name: "Notes" }), "/owner/members/m?tab=notes&facility=site");
  expect(screen.queryByRole("link", { name: "Documents" })).toBeNull();
  expectNative(screen.getByRole("link", { name: "Member and family access" }), "/owner/members/m/access?facility=site");
});
it("uses native Fees tabs with period and facility intact and preserves restricted plans", () => {
  render(<FeesTabs active="overview" period={{ from: "2026-11-01", to: "2026-11-30" }} facility="site" />);
  expectNative(screen.getByRole("link", { name: "Invoices" }), "/owner/fees?tab=invoices&from=2026-11-01&to=2026-11-30&facility=site");
  expect(screen.queryByRole("link", { name: "Plans" })).toBeNull();
});
it("keeps Fees follow-up and invoice links native and scoped", () => {
  const overview = { followUps: [{ id: "inv", payerName: "A", invoiceNumber: "INV-1", dueOn: "2026-11-10", outstandingPaise: 10000 }], methodTotals: [] } as unknown as Parameters<typeof FeesOverviewCards>[0]["overview"];
  render(<FeesOverviewCards overview={overview} facility="site" from="2026-11-01" to="2026-11-30" />);
  expectNative(screen.getByRole("link", { name: "All dues" }), "/owner/fees?tab=dues&facility=site&from=2026-11-01&to=2026-11-30");
  expectNative(screen.getByRole("link", { name: /INV-1/ }), "/owner/fees?tab=invoices&facility=site&from=2026-11-01&to=2026-11-30&invoice=inv");
});
it("labels payment method chart values as exact currency, not raw paise", () => {
  const overview = { methodTotals: [{ method: "cash", paise: 45600 }] } as unknown as Parameters<typeof FeesOverviewCards>[0]["overview"];
  render(<FeesOverviewCards overview={overview} facility="site" from="2026-11-01" to="2026-11-30" />);
  const chart = screen.getByRole("img", { name: /Gross recorded payments by method/ });
  expect(Array.from(chart.querySelectorAll("circle title")).map((title) => title.textContent)).toContain("Cash: ₹456.00");
});
it("keeps open and return links for a Settings category", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: "Open Business account settings" }).getAttribute("href")).toBe("/owner/settings?category=academy");
  cleanup();
  render(await SettingsPage({ searchParams: Promise.resolve({ category: "academy" }) }));
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/owner/settings");
});
